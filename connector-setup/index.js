require('colors');

var nconf = require('nconf');

var program = require('commander');
var async = require('async');
var request = require('request');
var urlJoin = require('url-join');

var firewall = require('../lib/firewall');
var path = require('path');

//steps
var certificate = require('./steps/certificate');
var configureConnection = require('./steps/configureConnection');

program
  .version(require('../package.json').version)
  .parse(process.argv);

exports.run = function (workingPath, extraEmptyVars, callback) {
  var provisioningTicket, info;

  if (typeof extraEmptyVars === 'function') {
    callback = extraEmptyVars;
    extraEmptyVars = [];
  }

  async.series([
    function (cb) {
      provisioningTicket = nconf.get('PROVISIONING_TICKET');

      if(provisioningTicket) return cb();

      program.prompt('Please enter the ticket number: ', function (pt) {
        provisioningTicket = pt;
        cb();
      });
    },
    function (cb) {
      var info_url = urlJoin(provisioningTicket, '/info');
      request.get({
        url: info_url
      }, function (err, response, body) {
        if (err) {
          if (err.code === 'ECONNREFUSED') {
            console.error('Unable to reach auth0 at: ' + info_url);
          }
          return cb(err);
        }
        if (response.statusCode == 404) {
          return cb (new Error('wrong ticket'));
        }

        var unexpected_response =
          response.statusCode !== 200 ||
          !~(response.headers['content-type'] || '').indexOf('application/json');

        if (unexpected_response) {
          return cb (new Error('Unexpected response from ticket information endpoint. \n\n Body is ' + response.body));
        }

        try {
          info = JSON.parse(body);
        } catch (parsing_error) {
          console.log(parsing_error);
          return callback(new Error('Unexpected response from ticket information endpoint. \n\n Body is ' + response.body));
        }

        cb();
      });
    },
    function (cb) {

      var do_not_configure_firewall = nconf.get('FIREWALL_RULE_CREATED') ||
                                      !info.kerberos ||
                                      process.platform !== 'win32';

      if (do_not_configure_firewall) {
        return cb();
      }

      //add a firewall rule the first time
      firewall.add_rule({
        name:    'Auth0ConnectorKerberos',
        program: path.resolve(path.join(__dirname, '/../node_modules/kerberos-server/kerberosproxy.net/KerberosProxy/bin/Debug/KerberosProxy.exe')),
        profile: 'private'
      });

      cb();
    },
    function (cb) {
      nconf.set('AD_HUB', info.adHub);
      nconf.set('PROVISIONING_TICKET', provisioningTicket);
      nconf.set('WSFED_ISSUER', info.connectionDomain);
      nconf.set('CONNECTION', info.connectionName);
      nconf.set('CLIENT_CERT_AUTH', info.certAuth);
      nconf.set('KERBEROS_AUTH', info.kerberos);
      nconf.set('FIREWALL_RULE_CREATED', info.kerberos);
      nconf.set('REALM', info.realm.name);
      nconf.set('SITE_NAME', nconf.get('SITE_NAME') || info.connectionName);
      nconf.set(info.realm.name, info.realm.postTokenUrl);
      extraEmptyVars.forEach(function (ev) {
        if (!nconf.get(ev)) nconf.set(ev, '');
      });
      nconf.save(cb);
    },
    function (cb) {
      certificate(workingPath, info, cb);
    },
    function (cb) {
      configureConnection(program, workingPath,
                          info,
                          provisioningTicket, cb);
    },
    function (cb) {
      nconf.save(cb);
    }
  ], function (err) {
    if (err) return callback(err);
    callback();
  });
};

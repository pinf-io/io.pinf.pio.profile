

const SPAWN = require("child_process").spawn;

// TODO: Combine with 'https://github.com/pinf-io/pio/blob/master/lib/ssh.js' and put into 'pinf.io' lib.

exports.for = function (API) {

    var exports = {};

	exports.generateKeys = function (privateKeyPath) {
		return API.Q.denodeify(function(callback) {
			API.console.verbose(("Generating private key at path: " + privateKeyPath).magenta);
			var proc = SPAWN("openssl", [
				"genrsa",
				"-out", privateKeyPath,
				2048
			]);
			proc.stdout.on("data", function (data) {
				error.push(data.toString());
			});
			var error = [];
			proc.stderr.on("data", function(data) {
				error.push(data.toString());
			});
			return proc.on('close', function (code) {
				if (code !== 0) {
					return callback(new Error("`openssl` exited with `code != 0` while generating private key: " + error.join("")));
				}
				return API.FS.chmod(privateKeyPath, 0400, callback);
			});
		})();
	}

    exports.exportPublicKeyFromPrivateKey = function(privateKeyPath, publicKeyPath, label) {
        return API.Q.denodeify(function(callback) {
            return API.FS.exists(publicKeyPath, function(exists) {
                if (exists) {
                    return callback(null);
                }
				API.console.verbose(("Extracting public key '" + publicKeyPath + "' from private key '" + privateKeyPath + "'").magenta);
                var pubKey = [];
                var proc = SPAWN("/usr/bin/ssh-keygen", [
                    '-y',
                    '-f', API.PATH.basename(privateKeyPath)
                ], {
                    cwd: API.PATH.dirname(privateKeyPath)
                });
                proc.stdout.on('data', function (data) {
                    pubKey.push(data.toString());
                });
                proc.stderr.on('data', function (data) {
                    process.stderr.write(data);
                });
                proc.on('close', function (code) {
                    if (code !== 0) {
                        console.error("ERROR: Key export exited with code '" + code + "'");
                        return callback(new Error("Key export exited with code '" + code + "'"));
                    }
                    return API.FS.outputFile(publicKeyPath, pubKey.join("").replace(/[\s\n]*$/, "") + " " + label, callback);
                });
            });
        })();
    }

    return exports;
}

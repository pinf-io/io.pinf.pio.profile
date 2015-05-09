
const EXEC = require("child_process").exec;


exports.for = function (API) {

	var exports = {};

	function callKeychain(action, args) {
		var deferred = API.Q.defer();
		// NOTE: We are using an absolute path to ensure we get the correct binary.
		EXEC("/usr/bin/security -q " + action + " " + args.join(" "), function(error, stdout, stderr) {
			if (action === "find-generic-password") {
				if (/The specified item could not be found in the keychain/.test(stderr)) {
					return deferred.resolve(null);
				} else {
					return deferred.resolve(stderr);
				}
			} 
			if (error) {
				return deferred.reject(new Error("Error calling `security`: " + stderr));
			}
			return deferred.resolve(stdout);
		});
		return deferred.promise;
	}

	exports.get = function (account, where) {
		return callKeychain("find-generic-password", [
			"-g",
			"-a", '"' + account + '"',
			"-s", '"' + where + '"'
		]).then(function(result) {
			if (!result) return null;
			var password = result.match(/password: "([^"]*)"/);
			if (!password) return null;
			return password[1];
		});
	}

	exports.set = function (label, account, where, value) {
		return callKeychain("add-generic-password", [
			// Account name (required)
			"-a", '"' + account + '"',
			// Service name (required)
			"-s", '"' + where + '"',
			// Label (Service name is used by default)
			"-l", '"' + label + '"',
			"-w", '"' + value + '"'
		]).then(function(result) {
			return true;
		});
	}

	return exports;
}

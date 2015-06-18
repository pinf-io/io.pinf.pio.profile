

require('org.pinf.genesis.lib/lib/api').forModule(require, module, function (API, exports) {

	const KEYCHAIN = API.KEYCHAIN.for(API);

	var Origin = function () {
		this.$PLComponent = "io.pinf.pio.profile/space.pinf.genesis-origin/0";
	}
	Origin.prototype.getSecretCode = function (verify) {
		var self = this;
		var account = "profile.pio.pinf.io";
		var where = self.label;
		var label = account + ": " + where;
		return KEYCHAIN.get(account, where).then(function(secret) {
			if (
				secret &&
				(!verify || verify === secret)
			) {
				return secret;
			}
			if (verify) {
				throw new Error("We stored new secret in keychain but cannot retrieve it again.");
			}
			API.console.verbose(("No existing secret found in keychain. Generating one.").magenta);

			secret = UUID.v4() + "-" + UUID.v4();
			API.console.verbose(("Storing secret in keychain under: " + where + " (" + label + ")").magenta);
			return KEYCHAIN.set(label, account, where, secret).then(function () {
				return self.getSecretCode(secret);
			});
		});
	}


	exports.PLComponent = function (config, groupConfig) {

		return {
			"$space.pinf.genesis/origin/0": API.EXTEND(true, new Origin(), config)
		};
	}

});


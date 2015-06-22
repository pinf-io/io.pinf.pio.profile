

exports.for = function (API) {


	var exports = {};

	exports.resolve = function (resolver, config, previousResolvedConfig) {

		return resolver({
			activatePathFromProfilePath: function (partiallyResolvedConfig, profilePath) {
				return profilePath.replace(/\.profile\.json$/, ".activate.sh");
			}
/*			
PINF.json
            "keys": {
                "io.pinf.pio": "{{generateKeyPairIfNoPrevious(io.pinf.pio)}}"
            }

			generateKeyPairIfNoPrevious: function (partiallyResolvedConfig, keyName) {
				if (
					previousResolvedConfig &&
					previousResolvedConfig.keys &&
					previousResolvedConfig.keys[keyName]
				) {
					return previousResolvedConfig.keys[keyName];
				}
				return API.ASYNC([
					"FORGE"
				], function (FORGE) {

console.log("keyName", keyName);

console.log("FORGE", FORGE);
console.log("generateKeyPairIfNoPrevious", partiallyResolvedConfig);
process.exit(1);

				});
			}
*/			
		}).then(function (resolvedConfig) {

//console.log("PIO PROFILE", resolvedConfig);

			var origin = resolvedConfig['$space.pinf.genesis/origin/0'];
			var originAccess = resolvedConfig['$space.pinf.genesis/access/0'];

/*
			return origin.getPublicKeyPath().then(function (keyPubPath) {

				resolvedConfig.keyPubPath = keyPubPath;

			}).then(function () {

				return origin.getPublicPem().then(function (keyPubPem) {

					resolvedConfig.keyPubPem = keyPubPem;
				});

			}).then(function () {
*/
				function ensureProfileSynced () {

				    return API.Q.fcall(function() {

					    API.ASSERT.equal(typeof resolvedConfig.files, "object");

						function syncFile (filename) {

							var fileinfo = resolvedConfig.files[filename];
							var fileExists = API.FS.existsSync(fileinfo.path);
							var fileMtime = (fileExists ? API.FS.statSync(fileinfo.path).mtime.getTime() : 0);

							if (
								fileExists &&
								(
									(
										previousResolvedConfig &&
										previousResolvedConfig.files &&
										previousResolvedConfig.files[filename] &&
										previousResolvedConfig.files[filename].localMtime === fileMtime
									) ||
									(
										fileinfo.remoteMtime &&
										fileinfo.localMtime === fileMtime
									)
								)
							) {
								resolvedConfig.files[filename].localMtime = 
									resolvedConfig.files[filename].localMtime ||
									previousResolvedConfig.files[filename].localMtime;
								resolvedConfig.files[filename].remoteMtime = 
									resolvedConfig.files[filename].remoteMtime ||
									previousResolvedConfig.files[filename].remoteMtime;
								API.console.verbose("Skip sync of '" + fileinfo.path + "' as it exists and mtime has not changed.");
								return API.Q.resolve();
							}

							API.console.verbose("Sync of '" + fileinfo.path + "' as mtime has changed or is missing.");

							function upload () {
			                	API.console.verbose(("Uploading profile managed file: " + fileinfo.path).magenta);
								return origin.encrypt(API.FS.readFileSync(fileinfo.path)).then(function (encrypted) {
				                    return originAccess.upload(filename, encrypted).then(function () {
				                    	// TODO: Just call 'HEAD' to get mtime.
							            return originAccess.download(filename).then(function (info) {
							            	if (!info) return;
											API.console.verbose("Record mtime of file '" + fileinfo.path + "' as '" + info[1] + "'.");
					                    	resolvedConfig.files[filename].remoteMtime = info[1];
											resolvedConfig.files[filename].localMtime = fileMtime;
					                        return;
					                    });
				                    });
				                });
							}

				            return originAccess.download(filename).then(function (info) {
								if (!info || !info[0]) {
									// No profile found remotely so need to upload.
									if (!fileExists) {
										API.console.verbose("Profile managed file '" + fileinfo.path + "' not found locally nor remote. Ignoring.");
										return;
									}
									API.console.verbose("Upload reason: does not exist online.");
									return upload();
								}
				            	var encrypted = info[0];
				            	var remoteFileMtime = info[1];
			                	API.console.debug("remoteFileMtime", remoteFileMtime);
			                	API.console.debug("fileMtime", fileMtime);
			                	// We upload if the local file has changed from previous turn.
								if (
									previousResolvedConfig &&
									previousResolvedConfig.files &&
									previousResolvedConfig.files[filename] &&
									previousResolvedConfig.files[filename].localMtime
								) {
				                	API.console.debug("previousResolvedConfig.files[" + filename + "].localMtime", previousResolvedConfig.files[filename].localMtime);
				                	if (fileMtime !== previousResolvedConfig.files[filename].localMtime) {
										API.console.verbose("Upload reason: local file mtime '" + fileMtime + "' does not match previous local file mtime '" + previousResolvedConfig.files[filename].localMtime + "'.");
										return upload();
				                	}
								}
				                return origin.decrypt(encrypted).then(function (decrypted) {
				                	API.console.verbose(("Writing downloaded profile managed file after decrypting to: " + fileinfo.path).magenta);
				                	try {
					                    API.FS.outputFileSync(fileinfo.path, decrypted);
					                } catch(err) {
					                	if (!fileExists) {
					                		throw err;
					                	}
					                	// @see https://github.com/cookch10/node-fs-filesysteminfo/blob/f527b423f1238ea4b18c8cc39b8a250b1fa1d93b/lib/fs-filesysteminfo.js#L75
										function integerToOctal (obj) {
											if (obj == null) {
												obj = '';
											}
											var str = '0' + (obj & parseInt('07777', 8)).toString(8);
											if (str === '00') {
												return '';
											} else {
												return str;
											}
										};
					                	var stat = API.FS.statSync(fileinfo.path);
										API.FS.chmodSync(fileinfo.path, 0700);
					                    API.FS.outputFileSync(fileinfo.path, decrypted);
										API.FS.chmodSync(fileinfo.path, parseInt(integerToOctal(stat.mode),8));
					                }
					                resolvedConfig.files[filename].remoteMtime = remoteFileMtime;
				                    resolvedConfig.files[filename].localMtime = API.FS.statSync(fileinfo.path).mtime.getTime();
				                    return;
				                });
				            });
				        }

				        var done = API.Q.resolve();
				        Object.keys(resolvedConfig.files).map(function (filename) {
				        	done = API.Q.when(done, function () {
				        		return syncFile(filename);
				        	});
				        });
				        return done;

				    }).fail(function(err) {
				        err.mesage += " (while syncing profile)";
				        err.stack += "\n(while syncing profile)";
				        throw err;
				    });
				}

				return ensureProfileSynced().then(function () {
					return resolvedConfig;
				});
		});
	}

	exports.turn = function (resolvedConfig) {

		return API.Q.denodeify(function (callback) {

//console.log ("TURN PIO PROFILE", resolvedConfig);

			return callback(null);
		})();
	}

	return exports;
}

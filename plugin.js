

exports.for = function (API) {

	const KEYCHAIN = require("./keychain").for(API);
	const SSH = require("./ssh").for(API);
	const UUID = require("uuid");
	const AWS = require("aws-sdk");


	function forEachStore (resolvedConfig, multiCallback) {

		var all = [];

		function aws (config) {
			// @see http://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html

		    API.ASSERT.equal(typeof config.iamUserName, "string");
		    API.ASSERT.equal(typeof config.accessKeyId, "string");
		    API.ASSERT.equal(typeof config.secretAccessKey, "string");
		    API.ASSERT.equal(typeof config.s3, "object");
		    API.ASSERT.equal(typeof config.s3.bucket, "string");
		    API.ASSERT.equal(typeof config.s3.publicHost, "string");
		    API.ASSERT.equal(typeof config.s3.path, "string");
		    API.ASSERT.equal(typeof config.s3.region, "string");

		    API.ASSERT.ok(/\.amazonaws\.com$/.test(config.s3.publicHost), "'publicHost' must end with '.amazonaws.com'");

		    var awsConfig = new AWS.Config({
		        accessKeyId: config.accessKeyId,
		        secretAccessKey: config.secretAccessKey,
		        region: config.s3.region
		    });

		    var s3 = new AWS.S3(awsConfig);

		    var api = {
		    	upload: function (filename, data) {
			        return API.Q.denodeify(function (callback) {
                    	API.console.verbose("Upload to bucket '" + config.s3.bucket + "'");
			            return s3.putObject({
			                ACL: "public-read",
			                Bucket: config.s3.bucket,
			                ContentType: "text/plain",
			                Key: API.PATH.join(config.s3.path, filename),
			                Body: new Buffer(data)
			            }, function (err, data) {
			                if (err) {
			                    API.console.error("Error uploading to AWS using key:", config.accessKeyId);
			                    return callback(err);
			                }
			                API.console.verbose("Uploaded profile to:", API.PATH.join(config.s3.bucket, config.s3.path, filename));
			                return callback(null);
			            });
			        })();
				},
				download: function (filename) {
			        return API.Q.denodeify(function (callback) {
                    	API.console.verbose("Download from bucket '" + config.s3.bucket + "'");
			            return s3.getObject({
			                Bucket: config.s3.bucket,
			                Key: API.PATH.join(config.s3.path, filename)
			            }, function (err, data) {
			                if (err) {
			                    if (err.code === "NoSuchBucket") {
			                    	API.console.verbose("Creating bucket '" + config.s3.bucket + "'");
									return s3.createBucket({
						                Bucket: config.s3.bucket,
						                ACL: "public-read"
						            }, function (err) {
						            	if (err) {
						            		if (err.code === "AccessDenied") {
						            			API.console.error("ERROR: Cannot create bucket '" + config.s3.bucket + "'. Make sure AWS access key id '" + config.accessKeyId + "' for iam user '" + config.iamUserName + "' has proper security policy set: https://console.aws.amazon.com/iam/home#users");
						            		}
						            		return callback(err);
						            	}
				                        return callback(null, null);
						            });
			                    }
			                    if (err.code === "NoSuchKey") {
			                        return callback(null, null);
			                    }
			                    API.console.error("Error uploading to AWS using key:", config.accessKeyId);
			                    return callback(err);
			                }
			                return callback(null, data.Body.toString(), new Date(data.LastModified).getTime());
			            });
			        })();
				}
		    }

            API.console.verbose("For profile store: aws");

		    all.push(API.Q.when(multiCallback(api))); 
		}

		for (var name in resolvedConfig.stores) {
			if (name === "aws") {
				aws(resolvedConfig.stores[name]);
			} else {
				throw new Error("Store '" + name + "' not supported!");
			}
		}

		return API.Q.all(all);
	}


	var exports = {};

	exports.resolve = function (resolver, config, previousResolvedConfig) {

		return resolver({
			activatePathFromProfilePath: function (partiallyResolvedConfig, profilePath) {
				return profilePath.replace(/\.profile\.json$/, ".activate.sh");
			}
		}).then(function (resolvedConfig) {

			resolvedConfig.keyPubPath = resolvedConfig.keyPath + ".pub";

			function ensurePrivateKey (verify) {
				// TODO: Add password to private key once we know that toolchain can use
				//       password agent at all times (or export private key without password temporarily only)
				if (!API.FS.existsSync(resolvedConfig.keyPath)) {
					if (verify) {
						throw new Error("Generated private key but could not find afterwards.");
					}
					if (API.FS.existsSync(resolvedConfig.keyPubPath)) {
						API.FS.removeSync(resolvedConfig.keyPubPath);
					}
					return SSH.generateKeys(resolvedConfig.keyPath).then(function () {
						if (API.FS.existsSync(resolvedConfig.keyPubPath)) {
							API.FS.removeSync(resolvedConfig.keyPubPath);
						}
						return ensurePrivateKey(true);
					});
				}
				return API.Q.resolve();
			}

			function ensurePublicKey (verify) {
				if (!API.FS.existsSync(resolvedConfig.keyPubPath)) {
					if (verify) {
						throw new Error("Generated public key but could not find afterwards.");
					}
					return SSH.exportPublicKeyFromPrivateKey(
						resolvedConfig.keyPath,
						resolvedConfig.keyPubPath,
						resolvedConfig.keyName + "@profile.pio.pinf.io"
					).then(function () {
						return ensurePublicKey(verify);
					});
				}
				return API.Q.resolve();
			}

			function ensureSecretInKeychain (verify) {
				var account = "profile.pio.pinf.io";
				var where = resolvedConfig.keyName;
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
						return ensureKeyInKeychain(secret);
					});
				});
			}

			function ensureProfileSynced (secret) {

			    return API.Q.fcall(function() {

				    API.ASSERT.equal(typeof resolvedConfig.files, "object");

			        var secretHash = API.CRYPTO.createHash("sha256").update(resolvedConfig.keyId + ":" + secret).digest();

			        function encrypt (decrypted) {
			            return API.Q.denodeify(API.CRYPTO.randomBytes)(32).then(function (buffer) {
			                var iv = API.CRYPTO.createHash("md5");
			                iv.update(buffer.toString("hex") + ":" + config.profileKey);
			                iv = iv.digest();
			                var encrypt = API.CRYPTO.createCipheriv('aes-256-cbc', secretHash, iv);
			                var encrypted = encrypt.update(decrypted, 'utf8', 'binary');
			                encrypted += encrypt.final('binary');
			                return iv.toString('hex') + ":" + new Buffer(encrypted, 'binary').toString('base64');
			            });
			        }

			        function decrypt (encrypted) {
			            return API.Q.fcall(function () {
			                encrypted = encrypted.split(":");
			                var decrypt = API.CRYPTO.createDecipheriv('aes-256-cbc', secretHash, new Buffer(encrypted.shift(), 'hex'));
			                var decrypted = decrypt.update(new Buffer(encrypted.join(":"), 'base64').toString('binary'), 'binary', 'utf8');
			                decrypted += decrypt.final('utf8');
			                return decrypted;
			            });
			        }

					return forEachStore(resolvedConfig, function (api) {

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
								return encrypt(API.FS.readFileSync(fileinfo.path)).then(function (encrypted) {
				                    return api.upload(filename, encrypted).then(function () {
				                    	// TODO: Just call 'HEAD' to get mtime.
							            return api.download(filename).then(function (info) {
											API.console.verbose("Record mtime of file '" + fileinfo.path + "' as '" + info[1] + "'.");
					                    	resolvedConfig.files[filename].remoteMtime = info[1];
											resolvedConfig.files[filename].localMtime = fileMtime;
					                        return;
					                    });
				                    });
				                });
							}

				            return api.download(filename).then(function (info) {
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
								if (
									previousResolvedConfig &&
									previousResolvedConfig.files &&
									previousResolvedConfig.files[filename] &&
									previousResolvedConfig.files[filename].remoteMtime
								) {
									if (remoteFileMtime < previousResolvedConfig.files[filename].remoteMtime) {
										API.console.verbose("Upload reason: Remote file mtime '" + remoteFileMtime + "' is smaller than previous remote file mtime '" + previousResolvedConfig.files[filename].remoteMtime + "'.");
										return upload();
									}
								} else
								if (remoteFileMtime < fileMtime) {
									API.console.verbose("Upload reason: Remote file mtime '" + remoteFileMtime + "' is smaller than local mtime '" + fileMtime + "'.");
									return upload();
								}
				                return decrypt(encrypted).then(function (decrypted) {
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
					});

			    }).fail(function(err) {
			        err.mesage += " (while syncing profile)";
			        err.stack += "\n(while syncing profile)";
			        throw err;
			    });
			}

			return ensureSecretInKeychain().then(function (secret) {

				return ensureProfileSynced(secret).then(function () {

					return ensurePrivateKey().then(function () {

						return ensureProfileSynced(secret);
					});
				});

			}).then(function () {

				return ensurePublicKey();
			}).then(function () {

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

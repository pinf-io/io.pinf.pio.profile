

require('org.pinf.genesis.lib/lib/api').forModule(require, module, function (API, exports) {

	const KEYCHAIN = API.KEYCHAIN.for(API);

	var Access = function () {
		var self = this;

		self.$PLComponent = "io.pinf.pio.profile/space.pinf.genesis-access/0";

		var S3 = function (config) {

		    this.config = config;

		    this.getConnection = function () {

		    	if (!config.secretAccessKey) {
		    		return null;
		    	}

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

			    // TODO: Delegate request signing to 'space.pinf.genesis/access/0' so we don't
			    //       need credentials here and potentially leak them.
			    var awsConfig = new API.AWS.Config({
			        accessKeyId: config.accessKeyId,
			        secretAccessKey: config.secretAccessKey,
			        region: config.s3.region
			    });

				return new API.AWS.S3(awsConfig);
		    }
		}
		S3.prototype.download = function (filename) {
			var self = this;

			var s3 = self.getConnection();
			if (!s3) return API.Q.resolve(null);

	        return API.Q.denodeify(function (callback) {
	        	API.console.verbose("Download from bucket '" + self.config.s3.bucket + "'");

	            return s3.getObject({
	                Bucket: self.config.s3.bucket,
	                Key: API.PATH.join(self.config.s3.path, filename)
	            }, function (err, data) {
	                if (err) {
	                    if (err.code === "NoSuchBucket") {
	                    	API.console.verbose("Creating bucket '" + self.config.s3.bucket + "'");
							return s3.createBucket({
				                Bucket: self.config.s3.bucket,
				                ACL: "public-read"
				            }, function (err) {
				            	if (err) {
				            		if (err.code === "AccessDenied") {
				            			API.console.error("ERROR: Cannot create bucket '" + self.config.s3.bucket + "'. Make sure AWS access key id '" + config.accessKeyId + "' for iam user '" + config.iamUserName + "' has proper security policy set: https://console.aws.amazon.com/iam/home#users");
				            		}
				            		return callback(err);
				            	}
		                        return callback(null, null);
				            });
	                    }
	                    if (err.code === "NoSuchKey") {
	                        return callback(null, null);
	                    }
	                    API.console.error("Error downloading from AWS S3 using key:", self.config.accessKeyId);
	                    console.error("ERROR", err.code, err.stack);
	                    return callback(err);
	                }
	                return callback(null, data.Body.toString(), new Date(data.LastModified).getTime());
	            });
	        })();
		}
		S3.prototype.upload = function (filename, data) {
			var self = this;

			var s3 = self.getConnection();
			if (!s3) return API.Q.resolve(null);

	        return API.Q.denodeify(function (callback) {
            	API.console.verbose("Upload to bucket '" + self.config.s3.bucket + "'");
	            return s3.putObject({
	                ACL: "public-read",
	                Bucket: self.config.s3.bucket,
	                ContentType: "text/plain",
	                Key: API.PATH.join(self.config.s3.path, filename),
	                Body: new Buffer(data)
	            }, function (err, data) {
	                if (err) {
	                    API.console.error("Error uploading to AWS using key:", self.config.accessKeyId);
	                    return callback(err);
	                }
	                API.console.verbose("Uploaded profile to:", API.PATH.join(self.config.s3.bucket, self.config.s3.path, filename));
	                return callback(null);
	            });
	        })();
	    }


		function privateAPI (parent) {
			return new S3(parent.origin.stores.primary);
		}

		self.download = function (filename) {
			return privateAPI(this).download(filename);
		}
		self.upload = function (filename, data) {
			return privateAPI(this).upload(filename, data);
		}
	}

	exports.PLComponent = function (config, groupConfig) {

		return {
			"$space.pinf.genesis/access/0": API.EXTEND(true, new Access(), config)
		};
	}

});


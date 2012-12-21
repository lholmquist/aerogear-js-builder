#!/bin/env node
//  OpenShift sample Node application
var _ = require( 'underscore' ),
    express = require( 'express' ),
    app = express.createServer(),
    async = require( 'async'),
    crypto = require( 'crypto' ),
    cssConcat = require( 'css-concat' ),
    fetch = require( './lib/project' ).fetch,
    fs = require( 'fs' ),
    mime = require( 'mime' ),
    path = require( 'path' ),
    promiseUtils = require( 'node-promise' ),
    Promise = require( 'node-promise').Promise,
    when = require( 'node-promise').when,
    regexp = require( './lib/regexp' ),
    requirejs = require( 'requirejs' ),
    semver = require( 'semver' ),
    url = require( 'url' ),
    zip = require("node-native-zip" ),
    rimraf = require( "rimraf" );

var dataDir = process.env.OPENSHIFT_DATA_DIR || "/Users/lholmquist/develop/projects/aerogearjsbuilder/data/aerogear-js-stage/lholmquist/master/";
var appRoot = process.env.OPENSHIFT_APP_DIR  || "/Users/lholmquist/develop/projects/aerogearjsbuilder/";

//  Local cache for static content [fixed and loaded at startup]
var zcache = { 'index.html': '','builder.html':'', 'banner':"'<banner:meta.banner>'",'aerogearstart':"'<file_strip_banner:aerogear-js/", 'aerogearend':">'"};
zcache['index.html'] = fs.readFileSync('./index.html'); //  Cache index.html
zcache['builder.html'] = fs.readFileSync( "./builder.html" );

var Project = require( './lib/project' )
    .repoDir( "" )
    .stagingDir( dataDir + "aerogear-js-stage/" )
    .Project,
  filters = {},
  bundlePromises = {},
  dependenciesPromises = {};

app.use(express.bodyParser());

// Create "express" server.
var app  = express.createServer();


/*  =====================================================================  */
/*  Setup route handlers.  */
/*  =====================================================================  */

var bid = 0;

function applyFilter( baseUrl, filter, contents, ext, callback ) {
    if ( filter ) {
        require( path.join( baseUrl, filter ) )( contents, ext, callback );
    } else {
        callback( null, contents );
    }
}

var bjsid = 0;
function buildJSBundle( project, config, name, filter, optimize ) {
    var id = bjsid ++;
//    console.log( "buildJSBundle["+id+"]()" );
    var promise = new Promise(),
        baseUrl = config.baseUrl,
        wsDir = project.getWorkspaceDirSync(),
        ext = ( optimize ? ".min" : "" ) + ".js",
        out = path.join( project.getCompiledDirSync(), name + ext );

    fs.exists( out, function ( exists ) {
        if ( exists ) {
            console.log( "buildJSBundle: resolving promise" );
            promise.resolve( out );
        } else {
            async.waterfall([
                function( next ) {
                    console.log( "buildJSBundle["+id+"](): step 1" );
                    var outDir = path.dirname( config.out );
                    console.log( "mkdir '" + outDir + "'" );
                    fs.mkdir( outDir, function( err ) {
                        console.log(err);
                        if ( err && err.code != "EEXIST" ) {
                            next( err );
                        } else {
                            next();
                        }
                    });
                },
                function( next ) {
                    console.log( "buildJSBundle["+id+"](): step 2" );
                    try {
                        requirejs.optimize(
                            _.extend({
                                out: out,
                                optimize: ( optimize ? "uglify" : "none" )
                            }, config ),
                            function( response ) {
                                next( null, response );
                            }
                        );
                    } catch ( e ){
                        next( e.toString() );
                    }
                },
                function( response, next ) {
                    console.log( "buildJSBundle["+id+"](): step 3" );
                    fs.readFile( out, 'utf8', next );
                },
                function ( contents, next ) {
                    console.log( "buildJSBundle["+id+"](): step 4" );
                    applyFilter( baseUrl, filter, contents, ext, next );
                },
                function( contents, next ) {
                    fs.writeFile( out, contents, 'utf8', next );
                }
            ], function( err ) {
                if( err ) {
                    promise.reject( err );
                } else {
//                    console.log( "buildJSBundle: resolving promise" );
                    promise.resolve( out );
                }
            });
        }
    });
    return promise;
}

function buildZipBundle( project, name, config, digest, filter )  {
    console.log( "buildZipBundle()" );
    var promise = new Promise(),
        baseUrl = config.baseUrl,
        basename = path.basename( name, ".zip" ),
        out = path.join( project.getCompiledDirSync(), digest + ".zip" );

    fs.exists( out, function ( exists ) {
        if ( exists ) {
            promise.resolve( out );
        } else {
            promiseUtils.all([
                buildJSBundle( project, config, digest, filter ),
                buildJSBundle( project, config, digest, filter, true )
            ]).then(
                function( results ) {
                    var archive = new zip();

                    async.series([
                        function( next ) {
                            async.forEachSeries( results, function( bundle, done ) {
                                var nameInArchive;
                                if ( typeof( bundle ) === "string" ) {
                                    nameInArchive = path.basename( bundle ).replace( digest, name.substring( 0, name.lastIndexOf( "." )) );
                                    archive.addFiles( [{ name: nameInArchive, path: bundle }], done );
                                } else {
                                    archive.addFiles(
                                        bundle.map( function( file ) {
                                            var nameInArchive = path.basename( file ).replace( digest, name.substring( 0, name.lastIndexOf( "." )) );
                                            return( { name: nameInArchive, path: file } );
                                        }), done
                                    );
                                }
                            }, next );
                        },
                        function( next ) {
                            fs.writeFile( out, archive.toBuffer(), next );
                        }
                    ], function( err ) {
                        if( err ) {
                            promise.reject( err );
                        } else {
                            promise.resolve( out );
                        }
                    });
                }
            );
        }
    });
    return promise;
}

app.get( '/v1/bundle/:owner/:repo/:ref/:name?', function ( req, res ) {
  console.log( "Building bundle for " + req.params.owner + "/" + req.params.repo + " ref: " + req.params.ref );
    var project = new Project( req.params.owner, req.params.repo, req.params.ref ),
        include = req.param( "include", "main" ).split( "," ).sort(),
        exclude = req.param( "exclude", "" ).split( "," ).sort(),
        optimize = Boolean( req.param( "optimize", false ) ).valueOf(),
        wrapParam = req.param( "wrap" ),
        wrap = wrapParam?JSON.parse( wrapParam ) : undefined,
        pragmas = JSON.parse( req.param( "pragmas", "{}" ) ),
        pragmasOnSave = JSON.parse( req.param( "pragmasOnSave", "{}" ) ),
        name = req.params.name || ( req.params.repo + ".js" ),
        ext = (optimize !== "none" ? ".min" : "") + ( path.extname( name ) || ".js" ),
        mimetype = mime.lookup( ext ),
        filter = req.param( "filter" ),
        shasum = crypto.createHash( 'sha1' ),
        wsDir   = project.getWorkspaceDirSync(),
        baseUrl = wsDir,
        dstDir, dstFile, digest, hash;

    // var baseUrlFilters[baseUrl] = require(path.join(baseUrl, 'somemagicnameOrpackage.jsonEntry.js'));
  var config = {
    baseUrl: baseUrl,
    include: include,
        exclude: exclude,
        wrap: wrap,
        pragmas: pragmas,
        pragmasOnSave: pragmasOnSave,
        skipModuleInsertion: req.param( "skipModuleInsertion", "false" ) === "true" ,
        preserveLicenseComments: req.param( "preserveLicenseComments", "true" ) === "true"
  };
    shasum.update( JSON.stringify( config ) );
    shasum.update( mimetype );
    if ( filter ) {
        shasum.update( filter );
    }

    if ( mimetype === "application/zip" ) {
        // For the zip file, the name needs to be part of the hash because it will determine the name of the files inside the zip file
        shasum.update( name );
    }

    digest = shasum.digest( 'hex' );

    if ( mimetype === "application/zip" ) {
        hash = digest;
    } else {
        hash += ( optimize ? ".min" : "" );
    }

    function onBundleBuildError( error ) {
        console.log(error);
        res.header( "Access-Control-Allow-Origin", "*");
        res.send( error, 500 );
        delete bundlePromises[ digest ];
    }

    function buildBundle() {
        var hash = digest;
        if ( mimetype === "application/zip" ) {
            bundlePromises[ hash ] = buildZipBundle( project, name, config, digest, filter );
        } else if ( mimetype === "text/css" ) {
            bundlePromises[ hash ] = buildCSSBundles( project, config, digest, filter, optimize );
        } else {
            bundlePromises[ hash ] = buildJSBundle( project, config, digest, filter, optimize );
        }
        bundlePromises[ hash ].then( onBundleBuilt, onBundleBuildError );
    }

    function onBundleBuilt( bundle ) {
        var out,
            promise = new Promise();

        // Set up our promise callbacks
        promise.then(
            function( bundleInfo ) {
                res.header( "Access-Control-Allow-Origin", "*");
                res.download( bundleInfo.path, bundleInfo.name );
            },
            function() {
                // Try to land back on our feet if for some reasons the built bundle got cleaned up;
                delete bundlePromises[ hash ];
                buildBundle();
            }
        );

        if ( typeof( bundle ) === "string" ) {
            fs.exists( bundle, function ( exists ) {
                if ( exists ) {
                    promise.resolve( { path: bundle, name: name } );
                } else {
                    promise.reject();
                }
            });
        } else {
            out = path.join( project.getCompiledDirSync(), digest + ext + ".zip" );
            fs.exists( out, function ( exists ) {
                var archive;
                if ( exists ) {
                    promise.resolve( { path: out, name: name } );
                } else {
                    archive = new zip();
                    async.series([
                        function( next ) {
                            archive.addFiles(
                                bundle.map( function( file ) {
                                    var nameInArchive = path.basename( file ).replace( digest, name.substring( 0, name.lastIndexOf( "." )) );
                                    return( { name: nameInArchive, path: file } );
                                }),
                                next
                            );
                        },
                        function( next ) {
                           fs.writeFile( out, archive.toBuffer(), next );
                        }
                    ],
                    function( err ) {
                        if( err ) {
                            promise.reject();
                        } else {
                            promise.resolve( { path: out, name: name + ".zip" } );
                        }
                    });
               }
            });
        }
    }

    if ( !bundlePromises[ hash ] ) {
        buildBundle();
    } else {
        bundlePromises[ hash ].then( onBundleBuilt, onBundleBuildError );
    }
});

app.get( '/aerogearjsbuilder/bundle/:owner/:repo/:ref/:name?', function ( req, res ) {
    var project = new Project( req.params.owner, req.params.repo, req.params.ref ),
        include = req.param( "include", "main" ).split( "," ).sort(),
        exclude = req.param( "exclude", "" ).split( "," ).sort(),
        optimize = Boolean( req.param( "optimize", false ) ).valueOf(),
        name = req.params.name || ( req.params.repo + ".js" ),
        ext = (optimize !== "none" ? ".min" : "") + ( path.extname( name ) || ".js" ),
        mimetype = mime.lookup( ext ),
        shasum = crypto.createHash( 'sha1' ),
        wsDir   = project.getWorkspaceDirSync(),
        baseUrl = wsDir,
        dstDir, dstFile, digest, hash;

    // var baseUrlFilters[baseUrl] = require(path.join(baseUrl, 'somemagicnameOrpackage.jsonEntry.js'));
    var config = {
        baseUrl: baseUrl,
        include: include,
        exclude: exclude
    };
    shasum.update( JSON.stringify( config ) );
    shasum.update( mimetype );

    if ( mimetype === "application/zip" ) {
        // For the zip file, the name needs to be part of the hash because it will determine the name of the files inside the zip file
        shasum.update( name );
    }

    digest = shasum.digest( 'hex' );

    //if ( mimetype === "application/zip" ) {
        hash = digest;
    //} else {
    //    hash += ( optimize ? ".min" : "" );
   // }

    var directoryDate = Date.now();
    fs.mkdir( dataDir + directoryDate + "/", 0755, function( err ) {
        if( err ) {
            console.log( err );
            errorReponse( res );
            throw err;
        }

        console.log( "dir created" );

        //Begin ReadFile
        fs.readFile( dataDir + "gruntbase.js","utf-8", function( err, data) {
            if( err ) {
                console.log( "gruntbase"+err );
                errorReponse( res );
            }
            //build replacement
            var replacement = "[" + zcache[ "banner" ] + ", ";
            _.each( config.include, function( val, index, list ) {
                replacement += zcache[ "aerogearstart" ] + val + ".js" + zcache[ "aerogearend" ];
                if( (index+1) !== list.length ) {
                    replacement += ", ";
                }
            });

            replacement += "]";
            var temp = data.replace("\"@SRC@\"", replacement).replace("\"@DEST@\"", "'" + directoryDate + "/<%= pkg.name %>." + hash + ".js'" );
            //write a new temp grunt file
            fs.writeFile( dataDir + directoryDate + "/" + hash + ".js", temp, "utf8", function( err ) {

                if( err ) {
                    console.log( "oh snap" + err);
                    errorReponse( res );
                    throw err;
                }

                var util  = require('util'),
                spawn = require('child_process').spawn,
                grunt = spawn( "./node_modules/grunt/bin/grunt",["--base", dataDir, "--config", dataDir + directoryDate + "/" + hash + ".js" ]);
                //base should be where the files are, config is the grunt.js file
                grunt.stdout.on('data', function (data) {
                    console.log('stdout: ' + data);
                });

                grunt.stderr.on('data', function (data) {
                    console.log('stderr: ' + data);
                });

                grunt.on('exit', function (code) {
                    //res.send("success");
                    res.send( fs.readFileSync( dataDir + directoryDate + "/aerogear." + hash + ".js" ) );
                    console.log('child process exited with code ' + code);
                    //remove temp grunt file

                    rimraf( dataDir + directoryDate + "/", function( err ) {
                        if( err ) {
                            console.log( err );
                        }
                    });
                });
            });
        });
//End ReadFIle
    });


    function errorReponse( res ) {
        res.status( 500 );
        res.send( "error" );
    }

});

// Handler for GET /
app.get('/', function(req, res){
    res.send( zcache[ "builder.html" ], { "Content-Type": "text/html" } );
});

//TODO: probably a better way of doing this
app.get( "/css/*", function( req, res ) {
    res.send( fs.readFileSync("." + req.path ), { "Content-Type": "text/css" } );
});

app.get( "/js/*", function( req, res ) {
    res.send( fs.readFileSync("." + req.path ), { "Content-Type": "text/javascript" } );
});


//  Get the environment variables we need.
var ipaddr  = process.env.OPENSHIFT_INTERNAL_IP || "localhost";
var port    = process.env.OPENSHIFT_INTERNAL_PORT || 8080;

if (typeof ipaddr === "undefined") {
   console.warn('No OPENSHIFT_INTERNAL_IP environment variable');
}

//  terminator === the termination handler.
function terminator(sig) {
   if (typeof sig === "string") {
      console.log('%s: Received %s - terminating Node server ...',
                  Date(Date.now()), sig);
      process.exit(1);
   }
   console.log('%s: Node server stopped.', Date(Date.now()) );
}

//  Process on exit and signals.
process.on('exit', function() { terminator(); });

// Removed 'SIGPIPE' from the list - bugz 852598.
['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS',
 'SIGFPE', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGTERM'
].forEach(function(element, index, array) {
    process.on(element, function() { terminator(element); });
});

//  And start the app on that interface (and port).
app.listen(port, ipaddr, function() {
   console.log('%s: Node server started on %s:%d ...', Date(Date.now() ),
               ipaddr, port);
});


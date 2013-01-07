#!/bin/env node
//  OpenShift sample Node application
var _ = require( 'underscore' ),
    express = require( 'express' ),
    app = express.createServer(),
    crypto = require( 'crypto' ),
    fs = require( 'fs' ),
    mime = require( 'mime' ),
    path = require( 'path' ),
    url = require( 'url' ),
    zip = require("node-native-zip" ),
    rimraf = require( "rimraf" );

var dataDir = process.env.OPENSHIFT_DATA_DIR ? process.env.OPENSHIFT_DATA_DIR + "aerogear-js/" : "../aerogear-js/";
var tempSaveDir = process.env.OPENSHIFT_REPO_DIR ? process.env.OPENSHIFT_REPO_DIR + "data/" : "../aerogearjsbuilder/data/";

//  Local cache for static content [fixed and loaded at startup]
var zcache = {
    'index.html': '',
    'builder.html': '',
    'banner': "'<banner:meta.banner>'",
    'aerogearstart': "'<file_strip_banner:",
    'aerogearend':">'"
};
zcache[ 'index.html' ] = fs.readFileSync( './index.html' ); //  Cache index.html
zcache[ 'builder.html' ] = fs.readFileSync( "./builder.html" );

app.use(express.bodyParser());

// Create "express" server.
var app  = express.createServer();


/*  =====================================================================  */
/*  Setup route handlers.  */
/*  =====================================================================  */


app.get( '/aerogearjsbuilder/bundle/:owner/:repo/:ref/:name?', function ( req, res ) {
    var include = req.param( "include", "main" ).split( "," ).sort(),
        exclude = req.param( "exclude", "" ).split( "," ).sort(),
        external = req.param( "external", "" ).split( "," ).sort(),
        optimize = Boolean( req.param( "optimize", false ) ).valueOf(),
        name = req.params.name || ( req.params.repo + ".js" ),
        ext = (optimize !== "none" ? ".min" : "") + ( path.extname( name ) || ".js" ),
        mimetype = mime.lookup( ext ),
        shasum = crypto.createHash( 'sha1' ),
        dstDir, dstFile, digest, hash;

    if( external[0].length ) {
        include = include.concat( external );
    }
    var config = {
        include: include,
        exclude: exclude
    };
    shasum.update( JSON.stringify( config ) );
    shasum.update( mimetype );

    hash = shasum.digest( 'hex' );

    var directoryDate = Date.now();
    fs.mkdir( tempSaveDir + directoryDate + "/", 0755, function( err ) {
        if( err ) {
            errorResponse( res, err );
            throw err;
        }
        //Begin ReadFile
        fs.readFile( "gruntbase.js","utf-8", function( err, data) {
            if( err ) {
                errorResponse( res, err );
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
            var temp = data.replace("\"@SRC@\"", replacement).replace("\"@DEST@\"", "'" + tempSaveDir + directoryDate + "/<%= pkg.name %>." + hash + ".js'" ).replace( "\"@DESTMIN@\"",  "'" + tempSaveDir + directoryDate + "/<%= pkg.name %>." + hash + ".min.js'" );
            //write a new temp grunt file
            fs.writeFile( tempSaveDir + directoryDate + "/" + hash + ".js", temp, "utf8", function( err ) {

                if( err ) {
                    errorResponse( res, err );
                    throw err;
                }
                var util  = require('util'),
                spawn = require('child_process').spawn,
                grunt = spawn( "./node_modules/grunt/bin/grunt",["--base", dataDir, "--config", tempSaveDir + directoryDate + "/" + hash + ".js" ]);
                //base should be where the files are, config is the grunt.js file
                grunt.stdout.on('data', function (data) {
                    console.log('stdout: ' + data);
                });

                grunt.stderr.on('data', function (data) {
                    console.log('stderr: ' + data);
                });

                grunt.on('exit', function (code) {

                    //Files are created, time to zip them up
                    var archive = new zip();
                    archive.addFiles([
                        { name: "aerogear." + hash + ".min.js", path: tempSaveDir + directoryDate + "/aerogear." + hash + ".min.js" },
                        { name: "aerogear." + hash + ".js", path: tempSaveDir + directoryDate + "/aerogear." + hash + ".js" }
                    ], function( err ) {
                        if( err ) {
                            errorResponse( res, err );
                        }
                        var buff = archive.toBuffer();

                        res.send( buff );
                        //res.send( fs.readFileSync( dataDir + directoryDate + "/aerogear." + hash + ".min.js" ) );
                        console.log('child process exited with code ' + code);
                        //remove temp grunt file

                        rimraf( tempSaveDir + directoryDate + "/", function( err ) {
                            if( err ) {
                                console.log( err );
                            }
                        });
                    });
                });
            });
        });
//End ReadFIle
    });


    function errorResponse( res, err ) {
        res.status( 500 );
        res.send( err );
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


//OPENSHIFT Stuff

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


var appRoot = process.env.OPENSHIFT_APP_DIR  || "/Users/lholmquist/develop/projects/aerogearjsbuilder/";


var util  = require('util'),
            spawn = require('child_process').spawn,
            grunt = spawn( "./node_modules/grunt/bin/grunt",["--base","./data/aerogear-js-stage/lholmquist/master/", "--config", "./data/aerogear-js-stage/lholmquist/master/notgrunt.js" ]);
//"--config", hash + ".js"
//./"+appRoot+"node_modules/grunt/bin/
//,{cwd:"./data/aerogear-js-stage/lholmquist/master/"} 
            grunt.stdout.on('data', function (data) {
                console.log('stdout: ' + data);
            });

            grunt.stderr.on('data', function (data) {
                console.log('stderr: ' + data);
            });

            grunt.on('exit', function (code) {
                //res.send("success");
                //res.send( fs.readFileSync("./data/aerogear-js-stage/lholmquist/master/dist/aerogear."+hash+".js" ) );
                console.log('child process exited with code ' + code);
                /*fs.unlink("./data/aerogear-js-stage/lholmquist/master/"+hash+".js", function( err ){
                    if ( err ) throw err;
                    console.log( 'file deleted' );
                });
                fs.unlink("./data/aerogear-js-stage/lholmquist/master/dist/aerogear."+hash+".js", function( err ){
                    if ( err ) throw err;
                    console.log( 'file deleted' );
                });*/
            });
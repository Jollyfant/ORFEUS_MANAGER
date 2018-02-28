const CONFIG = require("../config");
const path = require("path");
const Database = require("./orfeus-database");
const Console = require("./orfeus-logging");
const HTTPRequest = require("./orfeus-http");
const SHA256 = require("./orfeus-crypto.js");
const libxmljs = require("libxmljs");
const childProcess = require("child_process");

const E_CHILD_PROCESS = 1;
const FDSNWS_STATION_URL = "http://www.orfeus-eu.org/fdsnws/station/1/query";

var GLOBAL_CALLBACK;

const groupQuery = {
  "$group": {
    "_id": {
      "network": "$network",
      "station": "$station",
    },
    "id": {
      "$last": "$_id"
    },
    "created": {
      "$last": "$created"
    },
    "status": {
      "$last": "$status"
    },
    "filepath": {
      "$last": "$filepath"
    },
    "sha256": {
      "$last": "$sha256"
    }
  }
}

// Connect to the database
Database.connect(function(error) {

  // Start the daemon
  (metaDaemonInit = function() {

    // Get all most recent network & station documents
    // That need to be worked on
    var pipeline = [groupQuery, {
      "$match": {
        "status": {
          "$in": [
            Database.METADATA_STATUS_PENDING,
            Database.METADATA_STATUS_CONVERTED,
            Database.METADATA_STATUS_MERGED
          ]
        }
      }
    }];

    // Aggregate the results
    Database.files().aggregate(pipeline).toArray(function(error, results) {

      Console.info("Metad initialized with " + results.length + " metadata for processing");

      // Define a global callback
      (GLOBAL_CALLBACK = function() {

        // Put the daemon to sleep
        if(error || results.length === 0) {
          return metaDaemonSleep(CONFIG.METADATA.DAEMON.SLEEP_INTERVAL_MS);
        }

        // Get the next result
        var document = results.pop();

        // metaDaemonCallback document conversion, merging, and check for completion 
        switch(document.status) {
          case Database.METADATA_STATUS_PENDING:
            return metadConvert(document);
          case Database.METADATA_STATUS_CONVERTED:
            return metadMerge(document);
          case Database.METADATA_STATUS_MERGED:
            return metadCheck(document);
        }

      })();

    });

  })();

});


function metaDaemonSleep(time) {

  /* function metaDaemonSleep
   * Put the daemon to sleep for some time
   */

  Console.info("metaDaemon is sleeping for " + time + " miliseconds");

  setTimeout(metaDaemonInit, time);

}

function getStatusInfo(status) {

  /* function getStatusInfo
   * Returns states info based on status enum
   */

  switch(status) {
    case -1:
      return "METADATA_STATUS_UNCHANGED";
    case 0:
      return "METADATA_STATUS_REJECTED";
    case 1:
      return "METADATA_STATUS_PENDING";
    case 2:
      return "METADATA_STATUS_CONVERTED";
    case 3:
      return "METADATA_STATUS_MERGED";
    case 4:
      return "METADATA_STATUS_COMPLETED";
    default:
      return "METADATA_STATUS_UNKNOWN";
  }

}

function metaDaemonCallback(document, status) {

  /* function metaDaemonCallback
   * Fired after an attempted metadMerge, metadConvert or metadCheck
   * sets new status for metadata
   */

  // Nothing changed: proceed
  if(status === Database.METADATA_STATUS_UNCHANGED) {
    return GLOBAL_CALLBACK();
  }

  Console.info("Setting document " + document._id.network + "." + document._id.station + " to status " + getStatusInfo(status));

  var findQuery = {"_id": document.id}
  var setQuery = {"$set": {"status": status}}

  // Update the status of the file and fire the global callback
  Database.files().updateOne(findQuery, setQuery, GLOBAL_CALLBACK);

}

function getPrototype(network) {
  return path.join("prototypes", network + ".sc3ml");
}

function metadMerge(input) {

  /* function metadMerge
   * Attempts to merge new SC3ML station file with its full network
   */

  Console.info("metadMerge is requested for " + input._id.network + "." + input._id.station);

  var SEISCOMP_COMMAND = [
    "exec",
    "scinv",
    "merge",
    getPrototype(input._id.network),    
    input.filepath + ".sc3ml"
  ];

  // Spawn subprocess
  const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

  // Child process has closed
  convertor.on("close", function(code) {

    // Set status to rejected when failed
    if(code === E_CHILD_PROCESS) {
      metaDaemonCallback(input, Database.METADATA_STATUS_REJECTED);
    } else {
      metaDaemonCallback(input, Database.METADATA_STATUS_MERGED);
    }

  });

}

function metadCheck(input) {

  /* function metadCheck
   * metadChecks response against the FDSNWS Webservice to see if
   * a document has been included
   */

  // Only check sometimes (prevent overloading your service)
  //if(Math.random() > 0.1) {
    //return metaDaemonCallback(input, Database.METADATA_STATUS_UNCHANGED);
  //}

  Console.info("metadCheck is requested for " + input._id.network + "." + input._id.station);

  // Request instrument metadata
  const query = "?" + [
    "network=" + input._id.network,
    "station=" + input._id.station,
    "level=response"
  ].join("&");

  // Make a HTTP request to the webservice
  HTTPRequest(FDSNWS_STATION_URL + query, function(data) {

    if(data === null) {
      return metaDaemonCallback(input, Database.METADATA_STATUS_UNCHANGED);
    }

    // Parse the document returned by FDSNWS
    var XMLDocument = libxmljs.parseXml(data);
    var namespace = XMLDocument.root().namespace().href();
    var network = XMLDocument.get("xmlns:Network", namespace);

    // When the SHA256 of the document matches that of the webservice
    // it has been included in the inventory and status is set to METADATA_STATUS_COMPLETED
    if(SHA256(network.toString()) === input.sha256) {
      metaDaemonCallback(input, Database.METADATA_STATUS_COMPLETED);
    } else {
      metaDaemonCallback(input, Database.METADATA_STATUS_UNCHANGED);
    }

  });

}

function metadConvert(input) {

  /* functon metadConvert
   * Attempts to converts StationXML to SC3ML
   */

  Console.info("metadConvert is requested for " + input._id.network + "." + input._id.station);

  const SEISCOMP_COMMAND = [
    "exec",
    "fdsnxml2inv",
    input.filepath + ".stationXML",
    "-f",
    input.filepath + ".sc3ml"
  ];

  // Spawn subproceed
  const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

  // Child process has closed
  convertor.on("close", function(code) {

    // Set to rejected if the conversion fails
    if(code === E_CHILD_PROCESS) {
      metaDaemonCallback(input, Database.METADATA_STATUS_REJECTED);
    } else {
      metaDaemonCallback(input, Database.METADATA_STATUS_CONVERTED);
    }

  });

}
#!/bin/bash

# Retrieves SC3ML network prototypes from a running FDSNWS webservice
# These prototypes are used to validate submitted StationXML files
# This script needs to be run once during setup 

FDSNWS_STATION_PATH="fdsnws/station/1/query"
HELP_MESSAGE="Call 'sh prototypes.sh {node}' where Node is the EIDA node identifier (e.g. ODC)"
UNKNOWN_NODE_MESSAGE="Network prototypes for unknown node requested. For usage give -h."

case $1 in
  ODC)
    FDSNWS_STATION="http://www.orfeus-eu.org/$FDSNWS_STATION_PATH";;
  GFZ)
    FDSNWS_STATION="http://geofon.gfz-potsdam.de/$FDSNWS_STATION_PATH";;
  RESIF)
    FDSNWS_STATION="http://ws.resif.fr/$FDSNWS_STATION_PATH";;
  INGV)
    FDSNWS_STATION="http://webservices.ingv.it/$FDSNWS_STATION_PATH";;
  ETHZ)
    FDSNWS_STATION="http://eida.ethz.ch/$FDSNWS_STATION_PATH";;
  BGR)
    FDSNWS_STATION="http://eida.bgr.de/$FDSNWS_STATION_PATH";;
  NIEP)
    FDSNWS_STATION="http://eida-sc3.infp.ro/$FDSNWS_STATION_PATH";;
  KOERI)
    FDSNWS_STATION="http://eida-service.koeri.boun.edu.tr/$FDSNWS_STATION_PATH";;
  NOA)
    FDSNWS_STATION="http://eida.gein.noa.gr/$FDSNWS_STATION_PATH";;
  LMU)
    FDSNWS_STATION="http://erde.geophysik.uni-muenchen.de/$FDSNWS_STATION_PATH";;
  -h)
    echo $HELP_MESSAGE;;
  *)
    echo $UNKNOWN_NODE_MESSAGE; exit 1;;
esac

# Get all networks as text (skip response header)
curl -s "$FDSNWS_STATION?level=network&format=text" | sed 1d | while read line; do

  # Extract network information
  network=$(echo $line | cut -d '|' -f1)
  networkStart=$(echo $line | cut -d '|' -f3)
  networkEnd=$(echo $line | cut -d '|' -f4)

  # Extract the start year
  year=$(echo $networkStart | cut -d '-' -f1)

  # Extend the network code with the start year if a temporary deployment
  if [ -n "$networkEnd" ]; then
    networkCode=$(echo $network-$year)
  else
    networkCode=$(echo $network)
  fi

  echo "Downloading network prototype for $networkCode"

  # Fix for networks starting at UNIX time
  if [ "$networkStart" == "1970-01-01T00:00:00" ]; then
    networkStart="1970-01-01T00:00:01"
  fi

  # Get the FDSN StationXML for this station and convert to SC3ML network prototype
  curl -s "$FDSNWS_STATION?network=$network&level=network&endtime=$networkStart" | 
  xmllint --format - > "./prototypes/$networkCode.xml"

done

exit 0

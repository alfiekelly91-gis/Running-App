// polyline.js
//
// Strava sends each activity's route as an "encoded polyline" - a
// compact string format (the same one Google Maps uses) instead of a
// big list of [lat, lng] pairs. This function turns that string back
// into an array of coordinates Leaflet can draw.
//
// Algorithm reference: https://developers.google.com/maps/documentation/utilities/polylinealgorithm

function decodePolyline(encoded) {
  if (!encoded) return [];

  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);

    coordinates.push([lat * 1e-5, lng * 1e-5]);
  }

  return coordinates;
}

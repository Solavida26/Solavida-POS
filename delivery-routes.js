// Copyright 2014 Google Inc. All rights reserved.
//
// Licensed under the Apache License, Version 2.0 (the 'License');
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an 'AS IS' BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * Convert locations to and from short codes.
 *
 * Plus Codes are short, 10-11 character codes that can be used instead
 * of street addresses. The codes can be generated and decoded offline, and use
 * a reduced character set that minimises the chance of codes including words.
 *
 * Codes are able to be shortened relative to a nearby location. This means that
 * in many cases, only four to seven characters of the code are needed.
 * To recover the original code, the same location is not required, as long as
 * a nearby location is provided.
 *
 * Codes represent rectangular areas rather than points, and the longer the
 * code, the smaller the area. A 10 character code represents a 13.5x13.5
 * meter area (at the equator. An 11 character code represents approximately
 * a 2.8x3.5 meter area.
 *
 * Two encoding algorithms are used. The first 10 characters are pairs of
 * characters, one for latitude and one for longitude, using base 20. Each pair
 * reduces the area of the code by a factor of 400. Only even code lengths are
 * sensible, since an odd-numbered length would have sides in a ratio of 20:1.
 *
 * At position 11, the algorithm changes so that each character selects one
 * position from a 4x5 grid. This allows single-character refinements.
 *
 * Examples:
 *
 *   Encode a location, default accuracy:
 *   var code = OpenLocationCode.encode(47.365590, 8.524997);
 *
 *   Encode a location using one stage of additional refinement:
 *   var code = OpenLocationCode.encode(47.365590, 8.524997, 11);
 *
 *   Decode a full code:
 *   var coord = OpenLocationCode.decode(code);
 *   var msg = 'Center is ' + coord.latitudeCenter + ',' + coord.longitudeCenter;
 *
 *   Attempt to trim the first characters from a code:
 *   var shortCode = OpenLocationCode.shorten('8FVC9G8F+6X', 47.5, 8.5);
 *
 *   Recover the full code from a short code:
 *   var code = OpenLocationCode.recoverNearest('9G8F+6X', 47.4, 8.6);
 *   var code = OpenLocationCode.recoverNearest('8F+6X', 47.4, 8.6);
 */
(function(root, factory) {
  /* global define, module */
  if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define(function() {
      return (root.returnExportsGlobal = factory());
    });
  } else if (typeof module === 'object' && module.exports) {
    // Node. Does not work with strict CommonJS, but
    // only CommonJS-like environments that support module.exports,
    // like Node.
    module.exports = factory();
  } else {
    // Browser globals
    root.OpenLocationCode = factory();
  }
}(this, function() {
  var OpenLocationCode = {};

  /**
   * Provides a normal precision code, approximately 14x14 meters.
   * @const {number}
   */
  OpenLocationCode.CODE_PRECISION_NORMAL = 10;

  /**
   * Provides an extra precision code, approximately 2x3 meters.
   * @const {number}
   */
  OpenLocationCode.CODE_PRECISION_EXTRA = 11;

  // A separator used to break the code into two parts to aid memorability.
  var SEPARATOR_ = '+';

  // The number of characters to place before the separator.
  var SEPARATOR_POSITION_ = 8;

  // The character used to pad codes.
  var PADDING_CHARACTER_ = '0';

  // The character set used to encode the values.
  var CODE_ALPHABET_ = '23456789CFGHJMPQRVWX';

  // The base to use to convert numbers to/from.
  var ENCODING_BASE_ = CODE_ALPHABET_.length;

  // The maximum value for latitude in degrees.
  var LATITUDE_MAX_ = 90;

  // The maximum value for longitude in degrees.
  var LONGITUDE_MAX_ = 180;

  // The min number of digits in a Plus Code.
  var MIN_DIGIT_COUNT_ = 2;

  // The max number of digits to process in a Plus Code.
  var MAX_DIGIT_COUNT_ = 15;

  // Maximum code length using lat/lng pair encoding. The area of such a
  // code is approximately 13x13 meters (at the equator), and should be suitable
  // for identifying buildings. This excludes prefix and separator characters.
  var PAIR_CODE_LENGTH_ = 10;

  // First place value of the pairs (if the last pair value is 1).
  var PAIR_FIRST_PLACE_VALUE_ = Math.pow(
      ENCODING_BASE_, (PAIR_CODE_LENGTH_ / 2 - 1));

  // Inverse of the precision of the pair section of the code.
  var PAIR_PRECISION_ = Math.pow(ENCODING_BASE_, 3);

  // The resolution values in degrees for each position in the lat/lng pair
  // encoding. These give the place value of each position, and therefore the
  // dimensions of the resulting area.
  var PAIR_RESOLUTIONS_ = [20.0, 1.0, .05, .0025, .000125];

  // Number of digits in the grid precision part of the code.
  var GRID_CODE_LENGTH_ = MAX_DIGIT_COUNT_ - PAIR_CODE_LENGTH_;

  // Number of columns in the grid refinement method.
  var GRID_COLUMNS_ = 4;

  // Number of rows in the grid refinement method.
  var GRID_ROWS_ = 5;

  // First place value of the latitude grid (if the last place is 1).
  var GRID_LAT_FIRST_PLACE_VALUE_ = Math.pow(
      GRID_ROWS_, (GRID_CODE_LENGTH_ - 1));

  // First place value of the longitude grid (if the last place is 1).
  var GRID_LNG_FIRST_PLACE_VALUE_ = Math.pow(
      GRID_COLUMNS_, (GRID_CODE_LENGTH_ - 1));

  // Multiply latitude by this much to make it a multiple of the finest
  // precision.
  var FINAL_LAT_PRECISION_ = PAIR_PRECISION_ *
      Math.pow(GRID_ROWS_, (MAX_DIGIT_COUNT_ - PAIR_CODE_LENGTH_));

  // Multiply longitude by this much to make it a multiple of the finest
  // precision.
  var FINAL_LNG_PRECISION_ = PAIR_PRECISION_ *
      Math.pow(GRID_COLUMNS_, (MAX_DIGIT_COUNT_ - PAIR_CODE_LENGTH_));

  // Minimum length of a code that can be shortened.
  var MIN_TRIMMABLE_CODE_LEN_ = 6;

  /**
    @return {string} Returns the OLC alphabet.
   */
  OpenLocationCode.getAlphabet = function() {
    return CODE_ALPHABET_;
  };

  /**
   * Determines if a code is valid.
   *
   * To be valid, all characters must be from the Open Location Code character
   * set with at most one separator. The separator can be in any even-numbered
   * position up to the eighth digit.
   *
   * @param {string} code The string to check.
   * @return {boolean} True if the string is a valid code.
   */
  var isValid = OpenLocationCode.isValid = function(code) {
    if (!code || typeof code !== 'string') {
      return false;
    }
    // The separator is required.
    if (code.indexOf(SEPARATOR_) == -1) {
      return false;
    }
    if (code.indexOf(SEPARATOR_) != code.lastIndexOf(SEPARATOR_)) {
      return false;
    }
    // Is it the only character?
    if (code.length == 1) {
      return false;
    }
    // Is it in an illegal position?
    if (code.indexOf(SEPARATOR_) > SEPARATOR_POSITION_ ||
        code.indexOf(SEPARATOR_) % 2 == 1) {
      return false;
    }
    // We can have an even number of padding characters before the separator,
    // but then it must be the final character.
    if (code.indexOf(PADDING_CHARACTER_) > -1) {
      // Short codes cannot have padding
      if (code.indexOf(SEPARATOR_) < SEPARATOR_POSITION_) {
        return false;
      }
      // Not allowed to start with them!
      if (code.indexOf(PADDING_CHARACTER_) == 0) {
        return false;
      }
      // There can only be one group and it must have even length.
      var padMatch = code.match(new RegExp('(' + PADDING_CHARACTER_ + '+)', 'g'));
      if (padMatch.length > 1 || padMatch[0].length % 2 == 1 ||
          padMatch[0].length > SEPARATOR_POSITION_ - 2) {
        return false;
      }
      // If the code is long enough to end with a separator, make sure it does.
      if (code.charAt(code.length - 1) != SEPARATOR_) {
        return false;
      }
    }
    // If there are characters after the separator, make sure there isn't just
    // one of them (not legal).
    if (code.length - code.indexOf(SEPARATOR_) - 1 == 1) {
      return false;
    }

    // Strip the separator and any padding characters.
    code = code.replace(new RegExp('\\' + SEPARATOR_ + '+'), '')
        .replace(new RegExp(PADDING_CHARACTER_ + '+'), '');
    // Check the code contains only valid characters.
    for (var i = 0, len = code.length; i < len; i++) {
      var character = code.charAt(i).toUpperCase();
      if (character != SEPARATOR_ && CODE_ALPHABET_.indexOf(character) == -1) {
        return false;
      }
    }
    return true;
  };

  /**
   * Determines if a code is a valid short code.
   *
   * @param {string} code The string to check.
   * @return {boolean} True if the string can be produced by removing four or
   *     more characters from the start of a valid code.
   */
  var isShort = OpenLocationCode.isShort = function(code) {
    // Check it's valid.
    if (!isValid(code)) {
      return false;
    }
    // If there are less characters than expected before the SEPARATOR.
    if (code.indexOf(SEPARATOR_) >= 0 &&
        code.indexOf(SEPARATOR_) < SEPARATOR_POSITION_) {
      return true;
    }
    return false;
  };

  /**
   * Determines if a code is a valid full Open Location Code.
   *
   * @param {string} code The string to check.
   * @return {boolean} True if the code represents a valid latitude and
   *     longitude combination.
   */
  var isFull = OpenLocationCode.isFull = function(code) {
    if (!isValid(code)) {
      return false;
    }
    // If it's short, it's not full.
    if (isShort(code)) {
      return false;
    }

    // Work out what the first latitude character indicates for latitude.
    var firstLatValue = CODE_ALPHABET_.indexOf(
        code.charAt(0).toUpperCase()) * ENCODING_BASE_;
    if (firstLatValue >= LATITUDE_MAX_ * 2) {
      // The code would decode to a latitude of >= 90 degrees.
      return false;
    }
    if (code.length > 1) {
      // Work out what the first longitude character indicates for longitude.
      var firstLngValue = CODE_ALPHABET_.indexOf(
          code.charAt(1).toUpperCase()) * ENCODING_BASE_;
      if (firstLngValue >= LONGITUDE_MAX_ * 2) {
        // The code would decode to a longitude of >= 180 degrees.
        return false;
      }
    }
    return true;
  };

  /**
   * Encode a location into an Open Location Code.
   *
   * @param {number} latitude The latitude in signed decimal degrees. It will
   *     be clipped to the range -90 to 90.
   * @param {number} longitude The longitude in signed decimal degrees. Will be
   *     normalised to the range -180 to 180.
   * @param {?number} codeLength The length of the code to generate. If
   *     omitted, the value OpenLocationCode.CODE_PRECISION_NORMAL will be used.
   *     For a more precise result, OpenLocationCode.CODE_PRECISION_EXTRA is
   *     recommended.
   * @return {string} The code.
   * @throws {Exception} if any of the input values are not numbers.
   */
  var encode = OpenLocationCode.encode = function(latitude,
      longitude, codeLength) {
    latitude = Number(latitude);
    longitude = Number(longitude);

    const locationIntegers = locationToIntegers(latitude, longitude);

    return encodeIntegers(locationIntegers[0], locationIntegers[1], codeLength);
  };

  /**
   * Convert a latitude, longitude location into integer values.
   *
   * This function is only exposed for testing.
   *
   * Latitude is converted into a positive integer clipped into the range
   * 0 <= X < 180*2.5e7. (Latitude 90 needs to be adjusted to be slightly lower,
   * so that the returned code can also be decoded.
   * Longitude is converted into a positive integer and normalised into the range
   * 0 <= X < 360*8.192e6.

   * @param {number} latitude
   * @param {number} longitude
   * @return {Array<number>} A tuple of the latitude integer and longitude integer.
   */
  var locationToIntegers = OpenLocationCode.locationToIntegers = function(latitude, longitude) {
    var latVal = Math.floor(latitude * FINAL_LAT_PRECISION_);
    latVal += LATITUDE_MAX_ * FINAL_LAT_PRECISION_;
    if (latVal < 0) {
      latVal = 0;
    } else if (latVal >= 2 * LATITUDE_MAX_ * FINAL_LAT_PRECISION_) {
      latVal = 2 * LATITUDE_MAX_ * FINAL_LAT_PRECISION_ - 1;
    }
    var lngVal = Math.floor(longitude * FINAL_LNG_PRECISION_);
    lngVal += LONGITUDE_MAX_ * FINAL_LNG_PRECISION_;
    if (lngVal < 0) {
      lngVal =
        (lngVal % (2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_)) +
        2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_;
    } else if (lngVal >= 2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_) {
      lngVal = lngVal % (2 * LONGITUDE_MAX_ * FINAL_LNG_PRECISION_);
    }
    return [latVal, lngVal];
  };

  /**
   * Encode a location that uses integer values into an Open Location Code.
   *
   * This is a testing function, and should not be called directly.
   *
   * @param {number} latInt An integer latitude.
   * @param {number} lngInt An integer longitude.
   * @param {number=} codeLength The number of significant digits in the output
   *     code, not including any separator characters.
   * @return {string} A code of the specified length or the default length if not
   *     specified.
   * @throws {Exception} if any of the input values are not numbers.
   */
  var encodeIntegers = OpenLocationCode.encodeIntegers = function(latInt, lngInt, codeLength) {
    if (typeof codeLength == 'undefined') {
      codeLength = OpenLocationCode.CODE_PRECISION_NORMAL;
    } else {
      codeLength = Math.min(MAX_DIGIT_COUNT_, Number(codeLength));
    }
    if (isNaN(latInt) || isNaN(lngInt) || isNaN(codeLength)) {
      throw new Error('ValueError: Parameters are not numbers');
    }
    if (codeLength < MIN_DIGIT_COUNT_ ||
        (codeLength < PAIR_CODE_LENGTH_ && codeLength % 2 == 1)) {
      throw new Error('IllegalArgumentException: Invalid Open Location Code length');
    }
    // Javascript strings are immutable and it doesn't have a native
    // StringBuilder, so we'll use an array.
    const code = new Array(MAX_DIGIT_COUNT_ + 1);
    code[SEPARATOR_POSITION_] = SEPARATOR_;

    // Compute the grid part of the code if necessary.
    if (codeLength > PAIR_CODE_LENGTH_) {
      for (var i = MAX_DIGIT_COUNT_ - PAIR_CODE_LENGTH_; i >= 1; i--) {
        var latDigit = latInt % GRID_ROWS_;
        var lngDigit = lngInt % GRID_COLUMNS_;
        var ndx = latDigit * GRID_COLUMNS_ + lngDigit;
        code[SEPARATOR_POSITION_ + 2 + i] = CODE_ALPHABET_.charAt(ndx);
        // Note! Integer division.
        latInt = Math.floor(latInt / GRID_ROWS_);
        lngInt = Math.floor(lngInt / GRID_COLUMNS_);
      }
    } else {
      latInt = Math.floor(latInt / Math.pow(GRID_ROWS_, GRID_CODE_LENGTH_));
      lngInt = Math.floor(lngInt / Math.pow(GRID_COLUMNS_, GRID_CODE_LENGTH_));
    }

    // Add the pair after the separator.
    code[SEPARATOR_POSITION_ + 1] = CODE_ALPHABET_.charAt(latInt % ENCODING_BASE_);
    code[SEPARATOR_POSITION_ + 2] = CODE_ALPHABET_.charAt(lngInt % ENCODING_BASE_);
    latInt = Math.floor(latInt / ENCODING_BASE_);
    lngInt = Math.floor(lngInt / ENCODING_BASE_);

    // Compute the pair section of the code.
    for (var i = PAIR_CODE_LENGTH_ / 2 + 1; i >= 0; i -= 2) {
      code[i] = CODE_ALPHABET_.charAt(latInt % ENCODING_BASE_);
      code[i + 1] = CODE_ALPHABET_.charAt(lngInt % ENCODING_BASE_);
      latInt = Math.floor(latInt / ENCODING_BASE_);
      lngInt = Math.floor(lngInt / ENCODING_BASE_);
    }

    // If we don't need to pad the code, return the requested section.
    if (codeLength >= SEPARATOR_POSITION_) {
      return code.slice(0, codeLength + 1).join('');
    }
    // Pad and return the code.
    return code.slice(0, codeLength).join('') +
        Array(SEPARATOR_POSITION_ - codeLength + 1).join(PADDING_CHARACTER_) + SEPARATOR_;
  };

  /**
   * Decodes an Open Location Code into its location coordinates.
   *
   * Returns a CodeArea object that includes the coordinates of the bounding
   * box - the lower left, center and upper right.
   *
   * @param {string} code The code to decode.
   * @return {OpenLocationCode.CodeArea} An object with the coordinates of the
   *     area of the code.
   * @throws {Exception} If the code is not valid.
   */
  var decode = OpenLocationCode.decode = function(code) {
    // This calculates the values for the pair and grid section separately, using
    // integer arithmetic. Only at the final step are they converted to floating
    // point and combined.
    if (!isFull(code)) {
      throw new Error('IllegalArgumentException: ' +
          'Passed Plus Code is not a valid full code: ' + code);
    }
    // Strip the '+' and '0' characters from the code and convert to upper case.
    code = code.replace('+', '').replace(/0/g, '').toLocaleUpperCase('en-US');

    // Initialise the values for each section. We work them out as integers and
    // convert them to floats at the end.
    var normalLat = -LATITUDE_MAX_ * PAIR_PRECISION_;
    var normalLng = -LONGITUDE_MAX_ * PAIR_PRECISION_;
    var gridLat = 0;
    var gridLng = 0;
    // How many digits do we have to process?
    var digits = Math.min(code.length, PAIR_CODE_LENGTH_);
    // Define the place value for the most significant pair.
    var pv = PAIR_FIRST_PLACE_VALUE_;
    // Decode the paired digits.
    for (var i = 0; i < digits; i += 2) {
      normalLat += CODE_ALPHABET_.indexOf(code.charAt(i)) * pv;
      normalLng += CODE_ALPHABET_.indexOf(code.charAt(i + 1)) * pv;
      if (i < digits - 2) {
        pv /= ENCODING_BASE_;
      }
    }
    // Convert the place value to a float in degrees.
    var latPrecision = pv / PAIR_PRECISION_;
    var lngPrecision = pv / PAIR_PRECISION_;
    // Process any extra precision digits.
    if (code.length > PAIR_CODE_LENGTH_) {
      // Initialise the place values for the grid.
      var rowpv = GRID_LAT_FIRST_PLACE_VALUE_;
      var colpv = GRID_LNG_FIRST_PLACE_VALUE_;
      // How many digits do we have to process?
      digits = Math.min(code.length, MAX_DIGIT_COUNT_);
      for (var i = PAIR_CODE_LENGTH_; i < digits; i++) {
        var digitVal = CODE_ALPHABET_.indexOf(code.charAt(i));
        var row = Math.floor(digitVal / GRID_COLUMNS_);
        var col = digitVal % GRID_COLUMNS_;
        gridLat += row * rowpv;
        gridLng += col * colpv;
        if (i < digits - 1) {
          rowpv /= GRID_ROWS_;
          colpv /= GRID_COLUMNS_;
        }
      }
      // Adjust the precisions from the integer values to degrees.
      latPrecision = rowpv / FINAL_LAT_PRECISION_;
      lngPrecision = colpv / FINAL_LNG_PRECISION_;
    }
    // Merge the values from the normal and extra precision parts of the code.
    var lat = normalLat / PAIR_PRECISION_ + gridLat / FINAL_LAT_PRECISION_;
    var lng = normalLng / PAIR_PRECISION_ + gridLng / FINAL_LNG_PRECISION_;
    return new CodeArea(
        lat,
        lng,
        lat + latPrecision,
        lng + lngPrecision,
        Math.min(code.length, MAX_DIGIT_COUNT_));
  };

  /**
   * Recover the nearest matching code to a specified location.
   *
   * Given a valid short Open Location Code this recovers the nearest matching
   * full code to the specified location.
   *
   * @param {string} shortCode A valid short code.
   * @param {number} referenceLatitude The latitude to use for the reference
   *     location.
   * @param {number} referenceLongitude The longitude to use for the reference
   *     location.
   * @return {string} The nearest matching full code to the reference location.
   * @throws {Exception} if the short code is not valid, or the reference
   *     position values are not numbers.
   */
  OpenLocationCode.recoverNearest = function(
      shortCode, referenceLatitude, referenceLongitude) {
    if (!isShort(shortCode)) {
      if (isFull(shortCode)) {
        return shortCode.toUpperCase();
      } else {
        throw new Error(
            'ValueError: Passed short code is not valid: ' + shortCode);
      }
    }
    referenceLatitude = Number(referenceLatitude);
    referenceLongitude = Number(referenceLongitude);
    if (isNaN(referenceLatitude) || isNaN(referenceLongitude)) {
      throw new Error('ValueError: Reference position are not numbers');
    }
    // Ensure that latitude and longitude are valid.
    referenceLatitude = clipLatitude(referenceLatitude);
    referenceLongitude = normalizeLongitude(referenceLongitude);

    // Clean up the passed code.
    shortCode = shortCode.toUpperCase();
    // Compute the number of digits we need to recover.
    var paddingLength = SEPARATOR_POSITION_ - shortCode.indexOf(SEPARATOR_);
    // The resolution (height and width) of the padded area in degrees.
    var resolution = Math.pow(20, 2 - (paddingLength / 2));
    // Distance from the center to an edge (in degrees).
    var halfResolution = resolution / 2.0;

    // Use the reference location to pad the supplied short code and decode it.
    var codeArea = decode(
        encode(referenceLatitude, referenceLongitude).substr(0, paddingLength)
        + shortCode);
    // How many degrees latitude is the code from the reference? If it is more
    // than half the resolution, we need to move it north or south but keep it
    // within -90 to 90 degrees.
    if (referenceLatitude + halfResolution < codeArea.latitudeCenter &&
        codeArea.latitudeCenter - resolution >= -LATITUDE_MAX_) {
      // If the proposed code is more than half a cell north of the reference location,
      // it's too far, and the best match will be one cell south.
      codeArea.latitudeCenter -= resolution;
    } else if (referenceLatitude - halfResolution > codeArea.latitudeCenter &&
               codeArea.latitudeCenter + resolution <= LATITUDE_MAX_) {
      // If the proposed code is more than half a cell south of the reference location,
      // it's too far, and the best match will be one cell north.
      codeArea.latitudeCenter += resolution;
    }

    // How many degrees longitude is the code from the reference?
    if (referenceLongitude + halfResolution < codeArea.longitudeCenter) {
      codeArea.longitudeCenter -= resolution;
    } else if (referenceLongitude - halfResolution > codeArea.longitudeCenter) {
      codeArea.longitudeCenter += resolution;
    }

    return encode(
        codeArea.latitudeCenter, codeArea.longitudeCenter, codeArea.codeLength);
  };

  /**
   * Remove characters from the start of an OLC code.
   *
   * This uses a reference location to determine how many initial characters
   * can be removed from the OLC code. The number of characters that can be
   * removed depends on the distance between the code center and the reference
   * location.
   *
   * @param {string} code The full code to shorten.
   * @param {number} latitude The latitude to use for the reference location.
   * @param {number} longitude The longitude to use for the reference location.
   * @return {string} The code, shortened as much as possible that it is still
   *     the closest matching code to the reference location.
   * @throws {Exception} if the passed code is not a valid full code or the
   *     reference location values are not numbers.
   */
  OpenLocationCode.shorten = function(
      code, latitude, longitude) {
    if (!isFull(code)) {
      throw new Error('ValueError: Passed code is not valid and full: ' + code);
    }
    if (code.indexOf(PADDING_CHARACTER_) != -1) {
      throw new Error('ValueError: Cannot shorten padded codes: ' + code);
    }
    code = code.toUpperCase();
    var codeArea = decode(code);
    if (codeArea.codeLength < MIN_TRIMMABLE_CODE_LEN_) {
      throw new Error(
          'ValueError: Code length must be at least ' +
          MIN_TRIMMABLE_CODE_LEN_);
    }
    // Ensure that latitude and longitude are valid.
    latitude = Number(latitude);
    longitude = Number(longitude);
    if (isNaN(latitude) || isNaN(longitude)) {
      throw new Error('ValueError: Reference position are not numbers');
    }
    latitude = clipLatitude(latitude);
    longitude = normalizeLongitude(longitude);
    // How close are the latitude and longitude to the code center.
    var range = Math.max(
        Math.abs(codeArea.latitudeCenter - latitude),
        Math.abs(codeArea.longitudeCenter - longitude));
    for (var i = PAIR_RESOLUTIONS_.length - 2; i >= 1; i--) {
      // Check if we're close enough to shorten. The range must be less than 1/2
      // the resolution to shorten at all, and we want to allow some safety, so
      // use 0.3 instead of 0.5 as a multiplier.
      if (range < (PAIR_RESOLUTIONS_[i] * 0.3)) {
        // Trim it.
        return code.substring((i + 1) * 2);
      }
    }
    return code;
  };

  /**
   * Clip a latitude into the range -90 to 90.
   *
   * @param {number} latitude
   * @return {number} The latitude value clipped to be in the range.
   */
  var clipLatitude = function(latitude) {
    return Math.min(90, Math.max(-90, latitude));
  };

  /**
   * Normalize a longitude into the range -180 to 180, not including 180.
   *
   * @param {number} longitude
   * @return {number} Normalized into the range -180 to 180.
   */
  var normalizeLongitude = function(longitude) {
    while (longitude < -180) {
      longitude = longitude + 360;
    }
    while (longitude >= 180) {
      longitude = longitude - 360;
    }
    return longitude;
  };

  /**
   * Coordinates of a decoded Open Location Code.
   *
   * The coordinates include the latitude and longitude of the lower left and
   * upper right corners and the center of the bounding box for the area the
   * code represents.
   * @param {number} latitudeLo
   * @param {number} longitudeLo
   * @param {number} latitudeHi
   * @param {number} longitudeHi
   * @param {number} codeLength
   *
   * @constructor
   */
  var CodeArea = OpenLocationCode.CodeArea = function(
      latitudeLo, longitudeLo, latitudeHi, longitudeHi, codeLength) {
    return new OpenLocationCode.CodeArea.fn.Init(
        latitudeLo, longitudeLo, latitudeHi, longitudeHi, codeLength);
  };
  CodeArea.fn = CodeArea.prototype = {
    Init: function(
        latitudeLo, longitudeLo, latitudeHi, longitudeHi, codeLength) {
      /**
       * The latitude of the SW corner.
       * @type {number}
       */
      this.latitudeLo = latitudeLo;
      /**
       * The longitude of the SW corner in degrees.
       * @type {number}
       */
      this.longitudeLo = longitudeLo;
      /**
       * The latitude of the NE corner in degrees.
       * @type {number}
       */
      this.latitudeHi = latitudeHi;
      /**
       * The longitude of the NE corner in degrees.
       * @type {number}
       */
      this.longitudeHi = longitudeHi;
      /**
       * The number of digits in the code.
       * @type {number}
       */
      this.codeLength = codeLength;
      /**
       * The latitude of the center in degrees.
       * @type {number}
       */
      this.latitudeCenter = Math.min(
          latitudeLo + (latitudeHi - latitudeLo) / 2, LATITUDE_MAX_);
      /**
       * The longitude of the center in degrees.
       * @type {number}
       */
      this.longitudeCenter = Math.min(
          longitudeLo + (longitudeHi - longitudeLo) / 2, LONGITUDE_MAX_);
    },
  };
  CodeArea.fn.Init.prototype = CodeArea.fn;

  return OpenLocationCode;
}));

/* Read exact saved pins; never geocode a descriptive address or map viewport. */
(function(root){
 'use strict';
 const point=(a,b)=>{a=Number(a);b=Number(b);return Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a)<=90&&Math.abs(b)<=180?{latitude:a,longitude:b}:null;};
 function parse(value){
  if(!value||typeof value!=='string')return null;
  let text=value.trim();
  if(/^https?:/i.test(text)){
   let u;try{u=new URL(text);}catch{return null;}
   if(!/^(www\.|maps\.)?google\.(com|com\.ph)$/.test(u.hostname))return null;
   // Place coordinates outrank @camera coordinates, which must never become a pin.
   let path;try{path=decodeURIComponent(u.pathname);}catch{return null;}
   const pin=path.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
   if(pin)return point(pin[1],pin[2]);
   text=u.searchParams.get('query')||u.searchParams.get('q')||u.searchParams.get('destination')||'';
  }
  const decimal=text.trim().match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if(decimal)return point(decimal[1],decimal[2]);
  const dms=text.trim().match(/^(\d+(?:\.\d+)?)\s*[°º]\s*(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]\s*([NS])\s*[, ]*\s*(\d+(?:\.\d+)?)\s*[°º]\s*(\d+(?:\.\d+)?)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]\s*([EW])$/i);
  if(dms){if([2,3,6,7].some(i=>Number(dms[i])>=60))return null;return point((+dms[1]+dms[2]/60+dms[3]/3600)*(/S/i.test(dms[4])?-1:1),(+dms[5]+dms[6]/60+dms[7]/3600)*(/W/i.test(dms[8])?-1:1));}
  const plus=text.toUpperCase().match(/^([23456789CFGHJMPQRVWX]{4,8}\+[23456789CFGHJMPQRVWX]{2,3})(?:\s+(.*))?$/);
  if(plus){try{
   let code=plus[1];
   if(OpenLocationCode.isShort(code)){
    // Four omitted digits cover a 1-degree cell. Only resolve explicitly named
    // local service cities, safely near the owner-confirmed station reference.
    if(code.indexOf('+')!==4||! /^(DUMAGUETE(?: CITY)?|VALENCIA)(?:,? NEGROS ORIENTAL)?(?:,? PHILIPPINES)?$/.test(plus[2]||''))return null;
    code=OpenLocationCode.recoverNearest(code,9.3244018,123.2988483);
   }
   if(!OpenLocationCode.isFull(code))return null;
   const p=OpenLocationCode.decode(code);return point(p.latitudeCenter,p.longitudeCenter);
  }catch{return null;}}
  return null;
 }
 root.SolavidaSavedLocation={parse};
})(typeof window!=='undefined'?window:globalThis);

/* Solavida delivery routes. Financial completion remains in the existing Orders module. */
(() => {
 'use strict';
 const $=id=>document.getElementById(id), esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 // Owner-confirmed Google Maps place pin (not the map viewport center).
 const STATION={full_name:'Solavida — Start',latitude:9.3244018,longitude:123.2988483};
 const day=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila'}).format(new Date());
 const time=v=>v?new Date(v).toLocaleString('en-PH',{timeZone:'Asia/Manila',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'—';
 const duration=(a,b)=>a&&b?Math.round((new Date(b)-new Date(a))/60000)+' min':'—';
 const short=v=>String(v||'').replace(/^.*?(\d{1,6})$/,'$1');
 const num=v=>Number(v||0).toLocaleString('en-PH');
 const S={date:day(),area:'',orders:[],customers:[],employees:[],locations:[],trips:[],stops:[],members:[],events:[],selected:[],assignedOrders:[],team:[],driver:'',dispatch:false,nearby:false,map:null,layer:null,busy:false,request:crypto.randomUUID(),report:false,viewTrip:null};
 const customer=id=>S.customers.find(c=>c.id===id)||{full_name:'Customer',area:''};
 const emp=id=>S.employees.find(e=>e.id===id)?.full_name||'Unknown employee';
 const loc=id=>S.locations.find(l=>l.customer_id===id)||SolavidaSavedLocation.parse(customer(id).google_maps_url)||SolavidaSavedLocation.parse(customer(id).address);
 const order=id=>S.orders.find(o=>o.id===id);
 const qty=o=>(o?.order_items||[]).filter(i=>i.product?.unit==='container').reduce((n,i)=>n+Number(i.ordered_qty||0),0);
 const tripNo=t=>String(t.trip_no).padStart(4,'0');
 function error(e){const el=$('drMessage');if(el){el.className='dr-error';el.textContent=e.message||String(e);}else alert(e.message||String(e));}
 async function rpc(name,args){const r=await db.rpc(name,args);if(r.error)throw r.error;return r.data;}
 async function all(query){let rows=[];for(let n=0;;n+=1000){const r=await query().range(n,n+999);if(r.error)throw r.error;rows.push(...r.data);if(r.data.length<1000)return rows;}}
 async function refresh(){
  S.dispatch=!!await rpc('delivery_can_dispatch',{});
  const from=S.report?$('r85From').value:S.date,to=S.report?$('r85To').value:S.date;
  [S.customers,S.employees,S.orders,S.locations,S.trips]=await Promise.all([
   all(()=>db.from('customers').select('id,full_name,area,address,google_maps_url,last_order_at,active').order('id')),
   all(()=>db.from('employees').select('id,full_name,active,auth_user_id').order('id')),
   all(()=>{let q=db.from('orders').select('id,order_no,customer_id,area,business_date,status,payment_status,notes,actual_qty,containers_returned,order_items(ordered_qty,product:products(unit))').eq('channel','delivery');q=S.report?q.gte('business_date',from).lte('business_date',to):q.eq('status','pending');return q.order('business_date').order('id');}),
   all(()=>db.from('delivery_locations').select('*').order('customer_id')),
   all(()=>db.from('delivery_trips').select('*').gte('business_date',from).lte('business_date',to).order('business_date').order('trip_no'))
  ]);
  if(S.dispatch){const history=await rpc('delivery_customer_recency',{});const recent=new Map(history.map(h=>[h.customer_id,h.last_delivered_at]));S.customers.forEach(c=>c.last_order_at=recent.get(c.id)||null);}
  S.assignedOrders=!S.report&&S.dispatch?await all(()=>db.from('delivery_stops').select('order_id').is('released_at',null).not('order_id','is',null).order('id')):[];
  const ids=S.trips.map(t=>t.id);
  [S.stops,S.members,S.events]=ids.length?await Promise.all([
   all(()=>db.from('delivery_stops').select('*').in('trip_id',ids).order('id')),
   all(()=>db.from('delivery_trip_members').select('*').in('trip_id',ids).order('trip_id').order('employee_id')),
   window.currentEmployeeRole==='owner'?all(()=>db.from('delivery_route_events').select('*').in('trip_id',ids).order('id')):[]
  ]):[[],[],[]];
  const missing=S.stops.map(s=>s.order_id).filter(id=>id&&!S.orders.some(o=>o.id===id));
  if(missing.length)S.orders.push(...await all(()=>db.from('orders').select('id,order_no,customer_id,area,business_date,status,payment_status,notes,actual_qty,containers_returned,order_items(ordered_qty,product:products(unit))').in('id',missing).order('id')));
  if(!S.dispatch&&!S.viewTrip)S.viewTrip=S.trips.find(t=>t.status==='on_the_way')?.id||S.trips[0]?.id||null;
 }
 async function run(fn){if(S.busy)return;S.busy=true;document.querySelectorAll('.dr-root button').forEach(b=>b.disabled=true);try{await fn();}catch(e){error(e);}finally{S.busy=false;document.querySelectorAll('.dr-root button').forEach(b=>b.disabled=false);}}
 function root(){return S.report?$('r85Table'):$('map');}
 async function open(report=false){S.report=report;const r=root();r.classList.add('dr-root');r.innerHTML='<div class="dr-card">Loading delivery routes…<div id="drMessage"></div></div>';try{await refresh();render();}catch(e){error(e);}}
 function render(){
  if(S.report)return renderReport();
  const areas=[...new Set(S.customers.map(c=>c.area).filter(Boolean))].sort();
  const r=root();if(S.map){S.map.remove();S.map=null;}
  const assigned=new Set([...S.assignedOrders.map(s=>s.order_id),...S.stops.filter(s=>!s.released_at).map(s=>s.order_id)]);
  const pending=S.orders.filter(o=>o.status==='pending'&&!assigned.has(o.id)&&(!S.area||(o.area||customer(o.customer_id).area)===S.area));
  r.innerHTML=`<div class="dr-card"><h2>Delivery / Map</h2><p class="dr-muted">Choose customers → Check personnel → Mark on the way</p><div class="dr-toolbar dr-filters"><label>Trip date<input id="drDate" type="date" value="${esc(S.date)}"></label><label>Area (optional)<select id="drArea"><option value="">All areas</option>${areas.map(a=>`<option ${S.area===a?'selected':''}>${esc(a)}</option>`).join('')}</select></label><button data-do="refresh">Refresh</button></div><div id="drMessage" role="status"></div></div>
  ${!S.dispatch?'<div class="dr-card"><div id="drMap" class="dr-map"></div><p class="dr-muted">Assigned route stop sequence. Open navigation for road directions.</p></div>':''}${S.dispatch?`<div class="dr-layout"><div><div class="dr-card"><div id="drMap" class="dr-map"></div><p class="dr-location-help">${S.selected.filter(s=>!loc(s.customer_id)).length?'Saved customer map pins load automatically. Some selected customers need a precise location added once in Customers.':'Select customers to show their saved locations on the map.'}</p><p class="dr-muted">S: Solavida start · Numbers: delivery stops · Dashed lines show stop order, not road directions.</p><label><input type="checkbox" id="drNearby" ${S.nearby?'checked':''}> Show other customers${S.area?' in this area':''}</label><p class="dr-muted">Red: no completed delivery for 15+ days · Green: recent · Gray: no completed delivery. Customers without verified locations stay in the list.</p><div id="drNearbyList"></div></div></div><div><div class="dr-card"><h3>1. Choose customers</h3><p class="dr-muted">${pending.length} pending orders · All order dates · Area optional.</p><div class="dr-list">${pending.map(o=>`<div class="dr-order"><input type="checkbox" data-pick="${o.id}" ${S.selected.some(s=>s.order_id===o.id)?'checked':''} aria-label="Select ${esc(customer(o.customer_id).full_name)}"><label data-pick-name="${o.id}"><strong>${esc(customer(o.customer_id).full_name)}</strong><small>${esc(o.area||customer(o.customer_id).area||'No area')} · Order ${esc(short(o.order_no))} · ${num(qty(o))} containers · Ordered ${esc(o.business_date)}</small><small>${loc(o.customer_id)?'Saved location linked':'Precise pin unavailable — manual assignment available'}</small></label><button data-location="${o.customer_id}" title="Save verified location">Pin</button></div>`).join('')||'<p>No unassigned pending deliveries.</p>'}</div><div id="drSelected"></div></div><div class="dr-card"><h3>2. Delivery personnel</h3><details class="dr-personnel" id="drPersonnel"><summary><span id="drTeamSummary">${S.team.length?S.team.length+' selected':'Choose personnel'}</span><span class="dr-chevron" aria-hidden="true">⌄</span></summary><div class="dr-team">${S.employees.filter(e=>e.active).map(e=>`<label><input type="checkbox" data-member="${e.id}" ${S.team.includes(e.id)?'checked':''}> ${esc(e.full_name)}</label>`).join('')}</div><div class="dr-team-footer"><span>Choose one or more people</span><button type="button" data-do="team-done">Done</button></div></details><p id="drTeamNames" class="dr-team-names" ${S.team.length?'':'hidden'}>${esc(S.team.map(emp).join(', '))}</p><div class="dr-toolbar"><label>Driver<select id="drDriver"><option value="">Choose driver</option>${S.employees.filter(e=>S.team.includes(e.id)).map(e=>`<option value="${e.id}" ${S.driver===e.id?'selected':''}>${esc(e.full_name)}</option>`).join('')}</select></label></div><p class="dr-muted">The progress log records the signed-in person. Personnel without personal logins can be assigned, but cannot personally confirm arrival yet.</p><h3>3. Save this route</h3><button class="primary" data-do="save">Save route</button></div></div></div>`:''}
  <div class="dr-card"><h2>${S.dispatch?'Trips for this date':'My assigned trips'}</h2><div class="dr-kpis"><div><strong>${S.trips.length}</strong>Trips</div><div><strong>${S.stops.filter(s=>s.status==='completed').length} / ${S.stops.length}</strong>Stops completed</div><div><strong>${S.orders.filter(o=>o.status==='pending').length}</strong>Pending orders</div></div>${S.trips.map(tripCard).join('')||'<p>No trips assigned for this date.</p>'}</div>${window.currentEmployeeRole==='owner'?'<details class="dr-card"><summary>Dispatcher access</summary><p>Choose a staff member with a personal login. Only the Owner can grant or remove route-planning permission.</p><select id="drDispatcher">'+S.employees.filter(e=>e.active&&e.auth_user_id).map(e=>'<option value="'+e.id+'">'+esc(e.full_name)+'</option>').join('')+'</select> <button data-do="grant">Allow route planning</button> <button data-do="revoke">Remove permission</button></details>':''}`;
  $('drDate').onchange=()=>run(async()=>{if(S.selected.length&&!confirm('Changing the date clears the unsaved route. Continue?')){$('drDate').value=S.date;return;}S.date=$('drDate').value;S.selected=[];S.request=crypto.randomUUID();await refresh();render();});
  $('drArea').onchange=()=>{S.area=$('drArea').value;render();};
  r.onclick=click;r.onchange=change;const personnel=$('drPersonnel');if(personnel)personnel.onkeydown=e=>{if(e.key==='Escape'){personnel.open=false;personnel.querySelector('summary').focus();}};
  if(S.dispatch){drawSelected();nearby();}map();
 }
 function tripCard(t){const stops=S.stops.filter(s=>s.trip_id===t.id).sort((a,b)=>a.position-b.position),team=S.members.filter(m=>m.trip_id===t.id).map(m=>emp(m.employee_id)).join(', ');
  return `<details class="dr-stop" ${t.status!=='completed'?'open':''}><summary>Trip ${tripNo(t)} · ${esc(t.status.replaceAll('_',' '))} · ${stops.filter(s=>s.status==='completed').length}/${stops.length} stops</summary><button data-view-map="${t.id}">Show route on map</button><p><strong>Driver:</strong> ${esc(emp(t.driver_id))} · <strong>Personnel:</strong> ${esc(team)}</p><p class="dr-muted">Departure: ${time(t.started_at)} · Finished: ${time(t.finished_at)} · Duration: ${duration(t.started_at,t.finished_at)}</p>${stops.map(s=>{
   const c=customer(s.customer_id),o=order(s.order_id),l=loc(c.id),nav=l?`https://www.google.com/maps/dir/?api=1${s.position===1?'&origin='+encodeURIComponent(STATION.latitude+','+STATION.longitude):''}&destination=${encodeURIComponent(l.latitude+','+l.longitude)}`:null;
   return `<div class="dr-stop"><span class="dr-pill">${s.position}${t.planned_stops?' (planned '+((t.planned_stops||[]).find(x=>x.id===s.id)?.position??s.position)+')':''} · ${esc(s.status)}</span><h3>${esc(c.full_name)}</h3><p>${esc(c.address||c.area||'Address not saved')} ${o?'· Order '+esc(short(o.order_no)):'· Customer visit'}</p>${o?`<p>Scheduled: ${num(qty(o))} containers · ${esc(o.payment_status)}<br>${esc(o.notes||'')}</p>`:''}<p class="dr-muted">Arrived: ${time(s.arrived_at)} ${s.arrived_by?'by '+esc(emp(s.arrived_by)):''}<br>Completed: ${time(s.completed_at)} ${s.completed_by?'by '+esc(emp(s.completed_by)):''}</p>${s.snapshot?`<p>Delivered: ${num(s.snapshot.actual_qty)} · Returned: ${num(s.snapshot.containers_returned)}</p>`:''}${s.outcome?`<p>${esc(s.outcome)}</p>`:''}<div class="dr-actions">${nav?`<a class="dr-pill" href="${nav}" target="_blank" rel="noopener noreferrer">Open navigation ↗</a>`:'<span class="dr-muted">No verified map location</span>'}${t.status==='on_the_way'&&!['completed','skipped'].includes(s.status)?`${!s.arrived_at?`<button class="primary" data-arrive="${s.id}">Arrived</button>`:''}${s.order_id?`<button data-order="${s.order_id}">Open order / Complete delivery</button>`:`<button data-visit="${s.id}">Finish visit</button>`}`:''}${S.dispatch&&!['completed','cancelled'].includes(t.status)?`<button data-up="${s.id}" title="Move stop earlier">↑ Move earlier</button>`:''}</div></div>`;
  }).join('')}<div class="dr-actions">${S.dispatch&&t.status==='planned'?`<button class="primary" data-depart="${t.id}">Mark on the way</button><button data-cancel-plan="${t.id}">Cancel plan</button>`:''}${t.status==='on_the_way'?`<button class="primary" data-finish="${t.id}">Finish trip</button>`:''}</div></details>`;
 }
 function drawSelected(){const el=$('drSelected');if(!el)return;el.innerHTML='<h3>Selected stops · '+S.selected.length+'</h3>'+S.selected.map((s,i)=>`<div class="dr-order"><span>${i+1}.</span><strong>${esc(customer(s.customer_id).full_name)}</strong><button data-move="${i}">↑</button><button data-remove="${i}">Remove</button></div>`).join('')+`<p><strong>${num(S.selected.reduce((n,s)=>n+qty(order(s.order_id)),0))} containers scheduled</strong></p>`;}
 function toggle(id){S.viewTrip=null;const o=order(id),i=S.selected.findIndex(s=>s.order_id===id);if(i>=0)S.selected.splice(i,1);else S.selected.push({order_id:id,customer_id:o.customer_id});S.request=crypto.randomUUID();render();}
 function change(e){if(e.target.dataset.pick){toggle(e.target.dataset.pick);return;}if(e.target.dataset.member){S.team=[...root().querySelectorAll('[data-member]:checked')].map(x=>x.dataset.member);if(!S.team.includes(S.driver))S.driver='';$('drTeamSummary').textContent=S.team.length?S.team.length+' selected':'Choose personnel';$('drTeamNames').textContent=S.team.map(emp).join(', ');$('drTeamNames').hidden=!S.team.length;$('drDriver').innerHTML='<option value="">Choose driver</option>'+S.employees.filter(x=>S.team.includes(x.id)).map(x=>`<option value="${x.id}" ${S.driver===x.id?'selected':''}>${esc(x.full_name)}</option>`).join('');}if(e.target.id==='drDriver')S.driver=e.target.value;if(e.target.id==='drNearby'){S.nearby=e.target.checked;nearby();mapPins();}}
 async function click(e){const b=e.target.closest('button,[data-pick],[data-pick-name]');if(!b)return;
  if(b.dataset.do==='team-done'){$('drPersonnel').open=false;$('drPersonnel').querySelector('summary').focus();return;}if(b.dataset.viewMap){S.viewTrip=b.dataset.viewMap;mapPins();$('drMap')?.scrollIntoView({behavior:'smooth'});return;}if(b.dataset.pick)return;if(b.dataset.pickName){toggle(b.dataset.pickName);return;}
  if(b.dataset.move!==undefined){const i=Number(b.dataset.move);if(i>0)[S.selected[i-1],S.selected[i]]=[S.selected[i],S.selected[i-1]];drawSelected();mapPins();return;}
  if(b.dataset.remove!==undefined){S.selected.splice(Number(b.dataset.remove),1);render();return;}
  if(b.dataset.location){locationDialog(b.dataset.location);return;}
  if(b.dataset.visitAdd){if(!S.selected.some(s=>s.customer_id===b.dataset.visitAdd))S.selected.push({customer_id:b.dataset.visitAdd});render();return;}
  if(b.dataset.order){window.openDeliveryRouteOrder(b.dataset.order);return;}
  await run(async()=>{
   if(['grant','revoke'].includes(b.dataset.do)){await rpc('delivery_set_dispatcher',{p_employee:$('drDispatcher').value,p_enabled:b.dataset.do==='grant'});alert('Dispatcher permission saved and logged.');return;}
   if(b.dataset.cancelPlan){const reason=prompt('Reason for cancelling this unstarted plan (orders remain pending):');if(!reason)return;await rpc('delivery_cancel_plan',{p_trip:b.dataset.cancelPlan,p_reason:reason});await refresh();render();return;}
   if(b.dataset.do==='refresh'){await refresh();render();return;}
   if(b.dataset.do==='save'){
    if(!S.selected.length||!S.driver||!S.team.includes(S.driver))throw Error('Select customers, check personnel and choose the driver.');
    await rpc('delivery_plan',{p_id:S.request,p_date:S.date,p_driver:S.driver,p_members:S.team,p_stops:S.selected});S.viewTrip=S.request;S.selected=[];S.request=crypto.randomUUID();
   }else if(b.dataset.depart){if(!confirm('Start this trip now? Its orders will be marked On the way.'))return;await rpc('delivery_depart',{p_trip:b.dataset.depart});}
   else if(b.dataset.arrive){const s=S.stops.find(x=>x.id===b.dataset.arrive);const own=S.members.some(m=>m.trip_id===s.trip_id&&m.employee_id===window.currentEmployeeId);const note=own?null:prompt('Owner entry: who reported the arrival? This records your account and the current time.');if(!own&&!note)return;await rpc('delivery_stop_action',{p_stop:s.id,p_action:'arrive',p_note:note});}
   else if(b.dataset.visit){const note=prompt('Visit outcome (no automatic sale or container ledger entry):');if(!note)return;await rpc('delivery_stop_action',{p_stop:b.dataset.visit,p_action:'visit_complete',p_note:note});}
   else if(b.dataset.finish){if(!confirm('Finish this trip now?'))return;await rpc('delivery_finish',{p_trip:b.dataset.finish});}
   else if(b.dataset.up){const s=S.stops.find(x=>x.id===b.dataset.up),stops=S.stops.filter(x=>x.trip_id===s.trip_id).sort((a,b)=>a.position-b.position),i=stops.findIndex(x=>x.id===s.id);if(i===0)return;const reason=prompt('Reason for changing the stop order:');if(!reason)return;[stops[i-1],stops[i]]=[stops[i],stops[i-1]];await rpc('delivery_reorder',{p_trip:s.trip_id,p_ids:stops.map(x=>x.id),p_reason:reason});}
   else return;
   await refresh();render();if(typeof window.loadSolavidaOrders==='function')await window.loadSolavidaOrders();
  });
 }
 function locationDialog(id){const c=customer(id),l=loc(id);const d=document.createElement('dialog');d.innerHTML=`<h3>Verify ${esc(c.full_name)}’s location</h3><p>Use coordinates confirmed with the customer. Do not guess a pin.</p><label>Latitude<input id="drLat" type="number" step="any" min="-90" max="90" value="${l?.latitude??''}"></label><label>Longitude<input id="drLng" type="number" step="any" min="-180" max="180" value="${l?.longitude??''}"></label><button id="drLocationSave" class="primary">Save verified location</button> <button id="drLocationCancel">Cancel</button><p id="drLocationError" role="alert"></p>`;root().append(d);d.showModal();$('drLocationCancel').onclick=()=>d.remove();$('drLocationSave').onclick=async()=>{if(!$('drLat').value||!$('drLng').value){$('drLocationError').textContent='Both coordinates are required.';return;}try{await rpc('delivery_save_location',{p_customer:id,p_lat:Number($('drLat').value),p_lng:Number($('drLng').value)});d.remove();await refresh();render();}catch(e){$('drLocationError').textContent=e.message;}};}
 async function map(){if(!$('drMap'))return;try{if(!window.L){await new Promise((resolve,reject)=>{let s=document.querySelector('#drLeaflet');if(s){s.addEventListener('load',resolve,{once:true});s.addEventListener('error',reject,{once:true});return;}s=document.createElement('script');s.id='drLeaflet';s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';s.integrity='sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';s.crossOrigin='';s.onload=resolve;s.onerror=reject;document.head.append(s);});}if(!$('drMap')||S.map)return;S.map=L.map('drMap').setView([STATION.latitude,STATION.longitude],15);L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(S.map);S.layer=L.layerGroup().addTo(S.map);mapPins();}catch(e){if($('drMap'))$('drMap').textContent='Map unavailable. You can still select customers and assign routes using the lists.';}}
 function recency(c){if(!c.last_order_at)return 'gray';return (Date.now()-new Date(c.last_order_at))/86400000>=15?'red':'green';}
 function nearby(){const el=$('drNearbyList');if(!el)return;el.innerHTML=S.nearby?S.customers.filter(c=>c.active&&(!S.area||c.area===S.area)&&!S.selected.some(s=>s.customer_id===c.id)).map(c=>`<div class="dr-order"><span class="dr-pin ${recency(c)}" aria-label="${recency(c)}">•</span><label>${esc(c.full_name)}<small>${c.last_order_at?'Last completed delivery: '+time(c.last_order_at):'No completed delivery recorded'}${loc(c.id)?'':' · Location not saved'}</small></label><button data-visit-add="${c.id}">Add visit</button><button data-location="${c.id}">Pin</button></div>`).join(''):'';}
 function mapPins(){
  if(!S.map||!S.layer)return;S.layer.clearLayers();
  const start=[STATION.latitude,STATION.longitude],pts=[start];let previous=start;
  const add=(c,l,label,color='')=>{const m=L.marker([Number(l.latitude),Number(l.longitude)],{icon:L.divIcon({className:'',html:`<div class="dr-pin ${color}">${label}</div>`,iconSize:[30,30]})}).addTo(S.layer);m.bindPopup(esc(c.full_name));return m;};
  add(STATION,STATION,'S','station').bindTooltip('Solavida · Start',{permanent:true,direction:'top',offset:[0,-8]});
  const stops=S.viewTrip?S.stops.filter(s=>s.trip_id===S.viewTrip).sort((a,b)=>a.position-b.position):S.selected;
  stops.forEach((s,i)=>{const l=loc(s.customer_id);if(!l){previous=null;return;}const point=[Number(l.latitude),Number(l.longitude)];add(customer(s.customer_id),l,i+1,s.status==='completed'?'green':s.status==='skipped'?'gray':'');pts.push(point);if(previous)L.polyline([previous,point],{color:'#087bc1',dashArray:'6 8'}).addTo(S.layer);previous=point;});
  if(S.nearby)S.customers.filter(c=>c.active&&(!S.area||c.area===S.area)&&!stops.some(s=>s.customer_id===c.id)).forEach(c=>{const l=loc(c.id);if(l)add(c,l,'•',recency(c));});
  S.map.fitBounds(L.latLngBounds(pts),{padding:[45,45],maxZoom:15});
 }
 function reportRows(){return S.trips.map(t=>[t.business_date,tripNo(t),emp(t.driver_id),S.members.filter(m=>m.trip_id===t.id).map(m=>emp(m.employee_id)).join(' / '),S.stops.filter(s=>s.trip_id===t.id).length,S.stops.filter(s=>s.trip_id===t.id&&s.status==='completed').length,time(t.started_at),time(t.finished_at),duration(t.started_at,t.finished_at),t.status]);}
 function renderReport(){if(window.currentEmployeeRole!=='owner'){root().textContent='Owner access required.';return;}const headers=['Date','Trip','Driver','Personnel','Stops','Completed','Departure','Finished','Duration','Status'];const r=root();r85ManageRender();$('r85Kpis').innerHTML='';r85Warn('');r85Headers=headers;r85Rows=reportRows();r.classList.add('dr-root');r.innerHTML=`<h2>Delivery Route Report</h2><p class="dr-muted">Owner only · Actual recorded times in Philippine time. Arrival taps are staff declarations, not verified GPS presence. Duration alone does not prove fuel savings or wasted time.</p><div id="drMessage"></div><div class="dr-toolbar"><button id="drReportRefresh">Refresh</button><button id="drExport">Export for Excel</button><button id="drPrint">Print</button></div><div class="dr-scroll"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${reportRows().map(row=>`<tr>${row.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')||'<tr><td colspan="10">No trips for this period.</td></tr>'}</tbody></table></div>${S.trips.map(t=>`<details class="dr-stop"><summary>Trip ${tripNo(t)} · ${esc(t.business_date)} — stops and activity</summary>${tripCard(t)}<h3>Activity log</h3>${S.events.filter(e=>e.trip_id===t.id).map(e=>`<p>${time(e.recorded_at)} · ${esc(emp(e.actor_id))} · ${esc(e.event.replaceAll('_',' '))}${e.detail?.reason?' · '+esc(e.detail.reason):''}${e.detail?.note?' · '+esc(e.detail.note):''}</p>`).join('')}</details>`).join('')}`;
  // Reports are strictly read-only. Reuse detail markup but remove operational controls.
  r.querySelectorAll('.dr-stop button').forEach(b=>b.remove());
  $('drReportRefresh').onclick=()=>run(async()=>{await refresh();renderReport();});
  $('drExport').onclick=()=>{const safe=v=>{let s=String(v??'');if(/^[=+\-@\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};const rows=[headers,...reportRows(),[],['Trip','Customer','Order','Planned stop','Current stop','Arrival','Arrived by','Completed','Completed by','Delivered','Returned','Outcome']];for(const t of S.trips)for(const s of S.stops.filter(s=>s.trip_id===t.id).sort((a,b)=>a.position-b.position))rows.push([tripNo(t),customer(s.customer_id).full_name,short(order(s.order_id)?.order_no),(t.planned_stops||[]).find(x=>x.id===s.id)?.position??s.position,s.position,time(s.arrived_at),s.arrived_by?emp(s.arrived_by):'',time(s.completed_at),s.completed_by?emp(s.completed_by):'',s.snapshot?.actual_qty??'',s.snapshot?.containers_returned??'',s.outcome]);const u=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(safe).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=u;a.download='Solavida_Delivery_Routes_'+$('r85From').value+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(u),3000);};
  $('drPrint').onclick=()=>{const p=document.createElement('div');p.className='dr-print';p.innerHTML=r.innerHTML;p.querySelectorAll('details').forEach(d=>d.open=true);p.querySelectorAll('button,[id]').forEach(e=>{e.removeAttribute('id');if(e.tagName==='BUTTON')e.remove();});document.body.append(p);window.print();p.remove();};
 }
 const originalShow=window.showTab;window.showTab=function(tab){originalShow(tab);if(tab==='map')open(false);};
 const oldRender=window.r85Render;window.r85Render=function(){if(window.r85Tab===5||typeof r85Tab!=='undefined'&&r85Tab===5)return open(true);$('r85Table').classList.remove('dr-root');return oldRender();};
 if(typeof r85Names!=='undefined'){r85Names.push('Delivery Routes');const b=document.createElement('button');b.textContent='Delivery Routes';b.onclick=()=>r85SelectTab(5);$('r85Tabs').append(b);}
 const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.integrity='sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';css.crossOrigin='';document.head.append(css);
})();

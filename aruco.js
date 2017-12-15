'use strict'

// Represent a single marker.
// Has an int ID and an array of coordinates (corners).
class Marker {
  constructor(id, corners) {
    this.id = id
    this.corners = corners
  }
}

// The detector which find markers on the image.
class Detector {
  // The marker size is the number of the inner pixels.
  // E.g for a 3X3 is 3.
  constructor(markerSize, patterns) {
    // Check if we have at least on pattern.
    if (!patterns || patterns.length < 1) {
      throw new Error('Invalid patterns.')
    }

    // Now a basic pattern check.
    for (const pattern of patterns) {
      if (!pattern || pattern.length < 1) {
        throw new Error('Invalid pattern.', JSON.stringify(pattern))
      }
    }

    // Set the patterns to the detector.
    this._patterns = patterns
    // Set the marker size from the patterns.
    this._markerSize = patterns[0].length,
    // Calculate now for percormance tune.
    this._patternsCount = patterns.length

    this.epsilon = 0.05
    this.minimumLength = 10
  }

  // Find markers on the image.
  // Returns a list of Marker objects.
  detect(image) {
    // Create a grayscaled image.
    const imageGray = CV.grayscale(image)

    // Threshold the image.
    const imageThres = CV.adaptiveThreshold(imageGray, 2, 7)

    // Find the contours.
    const contours = CV.findContours(imageThres)

    // First run we find objects which look like a marker. Basically ~square object.
    const markerLikeObjects = this._findMarkerLikeObjects(contours, imageGray.width * 0.2, this.epsilon, this.minimumLength)

    // Recognize the marker in each object.
    const markers = this._getMarkers(imageGray, markerLikeObjects)

    return markers
  }

  // Find objects in the contours which can be markers.
  // Returns an array of polygon objects.
  _findMarkerLikeObjects(contours, minSize, epsilon, minLength) {
    const markerLikeObjects = []

    // Iterate over the contours.
    for (const contour of contours) {
      // If the contour is smaller then our minimum size skip it.
      if (contour.length < minSize) {
        continue
      }

      const polygon = CV.approxPolyDP(contour, contour.length * epsilon)

      // If the polygon has 4 point (corner), it's convex and the perimeter at least reach the minimum length
      // push it to the array.
      if (polygon.length === 4 &&
          CV.isContourConvex(polygon) &&
          CV.minEdgeLength(polygon) >= minLength) {
        markerLikeObjects.push(polygon)
      }
    }

    // Sort the corners by clockwise.
    this._sortPolygonsCorners(markerLikeObjects)

    // Then return the filtered array.
    return this._checkPolygonsDistance(markerLikeObjects, 10)
  }

  // Sort the corners of the polygon.
  // NOTE: It MODIFIES the ORIGINAL array.
  _sortPolygonsCorners(polygons) {
    // Iterate over the point of the polygon.
    for (let i = 0; i < polygons.length; ++i) {
      const dx1 = polygons[i][1].x - polygons[i][0].x
      const dy1 = polygons[i][1].y - polygons[i][0].y
      const dx2 = polygons[i][2].x - polygons[i][0].x
      const dy2 = polygons[i][2].y - polygons[i][0].y

      if (dx1 * dy2 - dy1 * dx2 < 0) {
        const swap = polygons[i][1]
        polygons[i][1] = polygons[i][3]
        polygons[i][3] = swap
      }
    }
  }

  // Remove the polygons too near each other.
  // Returns a new array of polygon objects.
  _checkPolygonsDistance(polygons, minDist) {
    const goodPolygons = []

    // Iterate over the polygons.
    for (let i = 0; i < polygons.length; ++i) {
      // Iterate over the polygons following the current polygon.
      for (let j = i + 1; j < polygons.length; ++j) {
        let distance = 0

        // Iterate over the points/corners.
        // NOTE: earlier we only accept polygons with 4 corner so for the performance we don't call
        // length, cause we assume this. (I mean that we really have 4 corner.)
        for (let k = 0; k < 4; ++k) {
          const dx = polygons[i][k].x - polygons[j][k].x
          const dy = polygons[i][k].y - polygons[j][k].y

          distance += dx * dx + dy * dy
        }

        if (distance / 4 < minDist * minDist) {
          // If the two polygon is too close each other, we skip the smaller one.
          if (CV.perimeter(polygons[i]) < CV.perimeter(polygons[j])) {
            polygons[i].skip = true
          } else {
            polygons[j].skip = true
          }
        }
      }
    }

    // Iterate over the polygons and use those which aren't marked for skip.
    for (const polygon of polygons) {
      if (!polygon.skip) {
        goodPolygons.push(polygon)
      }
    }

    return goodPolygons
  }

  // Try to find markers in the marker like object.
  // The markerSize is a pixel value which is substracted from the gray image.
  // Return an array of Marker object.
  _getMarkers(image, polygons) {
    // +2 for the black borders.
    const markerArea = (this._markerSize + 2) ** 2 * 2

    const markers = []

    // Iterate over the polygons.
    for (const polygon of polygons) {
      // Do a perspective transform.
      const imageTransformed = CV.warp(image,polygon, markerArea)

      // Find the threshold value with the OTSU algorithm.
      const thresholdValue = CV.otsu(imageTransformed)

      // Threshold the image.
      // NOTE: this function is MODIFIES the ORIGINAL image.
      CV.threshold(imageTransformed, thresholdValue)

      const marker = this._recognizeMarker(imageTransformed, polygon)

      // If we found one,
      if (marker) {
        // push it to our array.
        markers.push(marker)
      }
    }

    return markers
  }

  // Try to recognize marker in the image withing the given polygon.
  _recognizeMarker(image, polygon) {
    // +2 because of the black borders.
    const markerWidth = this._markerSize + 2

    // Convert to int. With bit operations it's faster.
    const width = image.width / markerWidth >>> 0
    // Shift by 1 means /2 too.
    const minBlackArea = (width * width) >> 1

    // Iterate over the rows. (X)
    for (let i = 0; i < markerWidth; ++i) {
      // For the border we need all pixels in the first and last row,
      // but only first and last pixels in the rows at mid.
      let step = i === 0 || i === markerWidth - 1 ? 1 : markerWidth - 1

      // Iterate over the columns. (Y)
      for (let j = 0; j < markerWidth; j += step) {
        const bitLocation = {
          x: j * width,
          y: i * width,
          width: width,
          height: width,
        }

        // We assume this is a black bit (along the border) so check this.
        if (CV.countNonZero(image, bitLocation) > minBlackArea) {
          return null
        }
      }
    }

    // Stores the information for each bit in the marker.
    const bits = []

    // Now iterate over only the inner marker area.
    for (let i = 0; i < this._markerSize; ++i) {
      bits[i] = []

      for (let j = 0; j < this._markerSize; ++j) {
        const bitLocation = {
          x: (j + 1) * width,
          y: (i + 1) * width,
          width: width,
          height: width,
        }

        // Fill the array with ones and zeros. Depending on the current bit.
        bits[i][j] = CV.countNonZero(image, bitLocation) > minBlackArea ? 1 : 0
      }
    }

    const rotations = []
    const distances = []

    rotations[0] = bits
    distances[0] = this._patternDistance(rotations[0])

    const pair = {}

    pair.first = distances[0]
    pair.second = 0

    // Get all the variants by rotation.
    for (let i = 1; i < 4; ++i) {
      rotations[i] = this._rotate( rotations[i - 1])
      distances[i] = this._patternDistance(rotations[i])

      if (distances[i] < pair.first) {
        pair.first = distances[i]
        pair.second = i
      }
    }

    if (pair.first !== 0) {
      return null
    }

    return new Marker(
      this._generateId(rotations[pair.second]),
      this._rotateOriginal(polygon, 4 - pair.second)
    )

  }

  // Calculate the marker distance from the patterns.
  // It calculates with the Hamming-distance.
  _patternDistance(bits) {
    let distance = 0
    let distanceTemp
    let minimumDistance

    // Iterate over the bits.
    for (let i = 0; i < this._markerSize; ++i) {

      minimumDistance = Infinity

      // Now over the patterns.
      for (let j = 0; j < this._patternsCount; ++j) {

        distanceTemp = 0

        for (let k = 0; k < this._markerSize; ++k) {
          // If not equals increase one.
          distanceTemp += bits[i][k] === this._patterns[j][k] ? 0 : 1
        }

        minimumDistance = distanceTemp < minimumDistance ? distanceTemp : minimumDistance
      }

      distance += minimumDistance
    }

    return distance
  }

  // Rotate the bits.
  _rotate(bits) {
    const rotated = []

    for (let i = 0; i < bits.length; ++i) {
      rotated[i] = []

      for (let j = 0; j < bits[i].length; ++j) {
        rotated[i][j] = bits[bits[i].length - j - 1][i]
      }
    }

    return rotated
  }

  // Generate an ID from the given bits (for a marker).
  _generateId(bits) {
    let id = 0

    for (let i = 0; i < this._markerSize; ++i) {
      id <<= 1
      id |= bits[i][1]
      id <<= 1
      id |= bits[i][this._markerSize - 2]
    }

    return id
  }

  // Rotate to orignal.
  _rotateOriginal(polygon, rotation) {
    const original = []

    for (let i = 0; i < polygon.length; ++i) {
      original[i] = polygon[(rotation + i) % polygon.length]
    }

    return original
  }
}

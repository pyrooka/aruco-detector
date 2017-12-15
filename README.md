# ArUco Detector
[ArUco](https://www.uco.es/investiga/grupos/ava/node/26) Detector is a JavaScript library for detecting [ArUco](https://www.uco.es/investiga/grupos/ava/node/26) markers. You can detect markers in various sizes with this one.  

Highly based on [Juan Mellado's code](https://github.com/jcmellado/js-aruco).  

I'm planning to rewrite the rest of the code for
- readability
- better comments
- better performance

but this is highly depends on my spare time.

## Note
The ID of a recognized marker won't be the same as in the native [ArUco](https://www.uco.es/investiga/grupos/ava/node/26) library. So before you use this, check your marker's ID in with the lib.

## Usage
```javacsript
// Define the patterns.
const patterns = [
  [1, 0, 1],
  [1, 1, 1],
]

// Create a Detector object whit them.
const detector = new Detector(patterns)

// Call the object's detect function with an image.
// Returns an array of Marker object.
const markers = detector.detect(image)
```

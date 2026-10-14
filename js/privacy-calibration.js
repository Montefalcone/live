// Fixed framing calibration from the approved 14 October 2026 still.
export const PRIVACY_CALIBRATION = {
  "width": 2048,
  "height": 1152,
  "artwork": "./assets/images/privacy-day.png",
  "regions": [
    {
      "name": "Apertura piccola",
      "x": 307,
      "y": 862,
      "width": 57,
      "height": 86,
      "samples": [
        {
          "x": 280,
          "y": 872,
          "width": 16,
          "height": 64,
          "reference": [
            133.415,
            112.97,
            83.562
          ]
        },
        {
          "x": 376,
          "y": 872,
          "width": 16,
          "height": 64,
          "reference": [
            145.412,
            121.639,
            89.769
          ]
        }
      ]
    },
    {
      "name": "Apertura sul balcone",
      "x": 403,
      "y": 819,
      "width": 72,
      "height": 176,
      "samples": [
        {
          "x": 484,
          "y": 828,
          "width": 24,
          "height": 48,
          "reference": [
            140.339,
            118.464,
            91.551
          ]
        },
        {
          "x": 376,
          "y": 816,
          "width": 16,
          "height": 40,
          "reference": [
            151.603,
            121.752,
            81.162
          ]
        }
      ]
    },
    {
      "name": "Portone inferiore",
      "x": 436,
      "y": 1035,
      "width": 93,
      "height": 116,
      "samples": [
        {
          "x": 536,
          "y": 1080,
          "width": 12,
          "height": 40,
          "reference": [
            127.365,
            106.058,
            66.656
          ]
        },
        {
          "x": 408,
          "y": 1080,
          "width": 12,
          "height": 40,
          "reference": [
            111.64,
            88.448,
            62.702
          ]
        }
      ]
    }
  ]
};

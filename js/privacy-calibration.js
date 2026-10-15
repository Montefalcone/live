// Day/night references: same 2048x1152 camera framing.
// Sky/facade contrast selects the photographic profile, never the device clock.
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
          ],
          "nightReference": [
            187.596,
            180.959,
            168.768
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
          ],
          "nightReference": [
            200.251,
            189.196,
            172.665
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
          ],
          "nightReference": [
            201.836,
            192.662,
            176.381
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
          ],
          "nightReference": [
            206.978,
            195.205,
            178.144
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
          ],
          "nightReference": [
            144.644,
            138.842,
            125.075
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
          ],
          "nightReference": [
            144.867,
            136.615,
            129.783
          ]
        }
      ]
    }
  ],
  "nightArtwork": "./assets/images/privacy-night-dark.png",
  "skySamples": [
    {
      "x": 200,
      "y": 120,
      "width": 160,
      "height": 100,
      "reference": [
        84.967,
        163.504,
        235.523
      ],
      "nightReference": [
        0.0,
        0.0,
        0.0
      ]
    },
    {
      "x": 800,
      "y": 80,
      "width": 180,
      "height": 100,
      "reference": [
        176.033,
        225.074,
        254.552
      ],
      "nightReference": [
        0.0,
        0.0,
        0.003
      ]
    },
    {
      "x": 1680,
      "y": 120,
      "width": 160,
      "height": 100,
      "reference": [
        241.982,
        251.236,
        253.646
      ],
      "nightReference": [
        0.0,
        0.0,
        0.0
      ]
    }
  ]
};

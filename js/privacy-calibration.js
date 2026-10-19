// Calibration of the five fixed camera masks from 2026-10-19.
// Continuous facade artwork; the roof uses a separate luminance measurement.
export const PRIVACY_CALIBRATION = {
  "width": 2048,
  "height": 1152,
  "artwork": "./assets/images/privacy-facades-day.png",
  "nightArtwork": "./assets/images/privacy-facades-night.png",
  "requireAllMasks": true,
  "regions": [
    {
      "name": "Facciate continue e raccordo del tetto",
      "x": 0,
      "y": 650,
      "width": 852,
      "height": 502,
      "maskChecks": [
        {
          "x": 8,
          "y": 946,
          "width": 603,
          "height": 192
        },
        {
          "x": 184,
          "y": 880,
          "width": 521,
          "height": 169
        },
        {
          "x": 327,
          "y": 820,
          "width": 284,
          "height": 319
        },
        {
          "x": 499,
          "y": 721,
          "width": 197,
          "height": 233
        },
        {
          "x": 627,
          "y": 820,
          "width": 172,
          "height": 135
        }
      ],
      "roofTexture": {
        "x": 480,
        "y": 705,
        "width": 130,
        "height": 52,
        "dx": -84,
        "dy": -42,
        "line": {
          "x0": 0,
          "y0": 938,
          "x1": 718,
          "y1": 662
        },
        "inset": 4,
        "transition": 3
      },
      "samples": [
        {
          "x": 110,
          "y": 918,
          "width": 28,
          "height": 10,
          "reference": [
            101.1,
            83.275,
            50.275
          ],
          "nightReference": [
            160.354,
            157.568,
            143.636
          ]
        },
        {
          "x": 220,
          "y": 856,
          "width": 28,
          "height": 10,
          "reference": [
            108.404,
            89.493,
            54.339
          ],
          "nightReference": [
            169.511,
            165.318,
            155.221
          ]
        },
        {
          "x": 430,
          "y": 790,
          "width": 28,
          "height": 12,
          "reference": [
            150.119,
            120.64,
            79.97
          ],
          "nightReference": [
            206.11,
            193.848,
            173.295
          ]
        },
        {
          "x": 670,
          "y": 690,
          "width": 24,
          "height": 10,
          "reference": [
            146.475,
            134.062,
            110.258
          ],
          "nightReference": [
            210.829,
            209.596,
            197.521
          ]
        },
        {
          "x": 818,
          "y": 864,
          "width": 12,
          "height": 48,
          "reference": [
            113.403,
            116.22,
            111.752
          ],
          "nightReference": [
            185.828,
            185.556,
            173.861
          ]
        },
        {
          "x": 650,
          "y": 1068,
          "width": 20,
          "height": 12,
          "reference": [
            115.812,
            116.688,
            97.5
          ],
          "nightReference": [
            155.862,
            156.154,
            149.596
          ]
        }
      ],
      "gainRange": [
        0.85,
        1.18
      ],
      "materials": [
        {
          "name": "Tegole",
          "lines": [
            {
              "x0": 0,
              "y0": 938,
              "x1": 718,
              "y1": 662
            },
            {
              "x0": 722,
              "y0": 820,
              "x1": 841,
              "y1": 755
            }
          ],
          "transition": 4,
          "samples": [
            {
              "x": 450,
              "y": 698,
              "width": 28,
              "height": 16,
              "reference": [
                47.953,
                34.453,
                25.958
              ],
              "nightReference": [
                1.42,
                1.261,
                1.011
              ]
            },
            {
              "x": 490,
              "y": 680,
              "width": 28,
              "height": 20,
              "reference": [
                45.416,
                35.702,
                28.654
              ],
              "nightReference": [
                2.162,
                2.021,
                1.682
              ]
            },
            {
              "x": 530,
              "y": 680,
              "width": 32,
              "height": 16,
              "reference": [
                52.768,
                40.791,
                31.016
              ],
              "nightReference": [
                2.57,
                2.455,
                1.641
              ]
            }
          ],
          "gainRange": [
            0.55,
            2.2
          ]
        }
      ]
    }
  ],
  "skySamples": [
    {
      "x": 200,
      "y": 120,
      "width": 160,
      "height": 100,
      "reference": [
        84.978,
        163.527,
        235.541
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
        176.209,
        225.127,
        254.553
      ],
      "nightReference": [
        0.0,
        0.0,
        0.001
      ]
    },
    {
      "x": 1680,
      "y": 120,
      "width": 160,
      "height": 100,
      "reference": [
        241.977,
        251.24,
        253.644
      ],
      "nightReference": [
        0.0,
        0.0,
        0.0
      ]
    }
  ]
};

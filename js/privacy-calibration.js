// Day/night references and calibrated local wall samples.
// Coordinates remain in the original 2048x1152 camera frame.
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
      ],
      "edgeBlend": {
        "aperture": [
          [
            298,
            869
          ],
          [
            348,
            849
          ],
          [
            371,
            940
          ],
          [
            313,
            961
          ]
        ],
        "innerWidth": 14,
        "samples": [
          {
            "x": 293,
            "y": 864,
            "width": 6,
            "height": 8,
            "reference": [
              149.417,
              118.979,
              77.729
            ],
            "referenceSigma": 0.55,
            "nightReference": [
              203.896,
              192.021,
              174.625
            ],
            "nightReferenceSigma": 0.954
          },
          {
            "x": 293,
            "y": 889,
            "width": 6,
            "height": 8,
            "reference": [
              149.875,
              121.458,
              83.979
            ],
            "referenceSigma": 0.911,
            "nightReference": [
              206.708,
              195.562,
              175.083
            ],
            "nightReferenceSigma": 1.694
          },
          {
            "x": 293,
            "y": 916,
            "width": 6,
            "height": 8,
            "reference": [
              144.667,
              121.854,
              88.312
            ],
            "referenceSigma": 1.62,
            "nightReference": [
              202.167,
              192.896,
              178.083
            ],
            "nightReferenceSigma": 2.801
          },
          {
            "x": 293,
            "y": 938,
            "width": 6,
            "height": 8,
            "reference": [
              124.708,
              109.188,
              84.958
            ],
            "referenceSigma": 7.451,
            "nightReference": [
              177.583,
              173.917,
              166.083
            ],
            "nightReferenceSigma": 8.188
          },
          {
            "x": 374,
            "y": 862,
            "width": 6,
            "height": 8,
            "reference": [
              152.458,
              124.271,
              85.812
            ],
            "referenceSigma": 0.74,
            "nightReference": [
              209.417,
              195.5,
              179.979
            ],
            "nightReferenceSigma": 1.441
          },
          {
            "x": 374,
            "y": 887,
            "width": 6,
            "height": 8,
            "reference": [
              148.854,
              124.042,
              91.083
            ],
            "referenceSigma": 0.999,
            "nightReference": [
              203.792,
              191.146,
              179.833
            ],
            "nightReferenceSigma": 1.529
          },
          {
            "x": 374,
            "y": 912,
            "width": 6,
            "height": 8,
            "reference": [
              143.917,
              122.229,
              92.625
            ],
            "referenceSigma": 0.869,
            "nightReference": [
              198.208,
              189.646,
              173.021
            ],
            "nightReferenceSigma": 1.878
          },
          {
            "x": 374,
            "y": 937,
            "width": 6,
            "height": 8,
            "reference": [
              136.458,
              114.875,
              85.479
            ],
            "referenceSigma": 2.314,
            "nightReference": [
              186.479,
              176.854,
              162.167
            ],
            "nightReferenceSigma": 3.627
          },
          {
            "x": 315,
            "y": 848,
            "width": 10,
            "height": 6,
            "reference": [
              150.05,
              121.417,
              78.567
            ],
            "referenceSigma": 0.362,
            "nightReference": [
              207.9,
              195.467,
              177.917
            ],
            "nightReferenceSigma": 2.03
          },
          {
            "x": 343,
            "y": 958,
            "width": 10,
            "height": 6,
            "reference": [
              119.733,
              97.617,
              64.933
            ],
            "referenceSigma": 2.401,
            "nightReference": [
              158.95,
              151.6,
              139.8
            ],
            "nightReferenceSigma": 2.589
          }
        ]
      }
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
      ],
      "edgeBlend": {
        "aperture": [
          [
            396,
            825
          ],
          [
            456,
            804
          ],
          [
            499,
            996
          ],
          [
            435,
            1018
          ]
        ],
        "innerWidth": 14,
        "maxY": 945,
        "samples": [
          {
            "x": 389,
            "y": 822,
            "width": 6,
            "height": 8,
            "reference": [
              150.104,
              118.188,
              78.083
            ],
            "referenceSigma": 1.177,
            "nightReference": [
              202.646,
              191.958,
              174.0
            ],
            "nightReferenceSigma": 2.647
          },
          {
            "x": 389,
            "y": 852,
            "width": 6,
            "height": 8,
            "reference": [
              150.688,
              122.062,
              85.104
            ],
            "referenceSigma": 0.821,
            "nightReference": [
              206.5,
              194.625,
              178.646
            ],
            "nightReferenceSigma": 1.507
          },
          {
            "x": 389,
            "y": 884,
            "width": 6,
            "height": 8,
            "reference": [
              146.833,
              123.188,
              93.167
            ],
            "referenceSigma": 0.757,
            "nightReference": [
              203.25,
              192.188,
              178.458
            ],
            "nightReferenceSigma": 1.557
          },
          {
            "x": 389,
            "y": 916,
            "width": 6,
            "height": 8,
            "reference": [
              140.062,
              117.479,
              87.229
            ],
            "referenceSigma": 1.308,
            "nightReference": [
              195.458,
              183.375,
              168.021
            ],
            "nightReferenceSigma": 1.922
          },
          {
            "x": 485,
            "y": 819,
            "width": 6,
            "height": 8,
            "reference": [
              142.854,
              121.562,
              90.896
            ],
            "referenceSigma": 1.109,
            "nightReference": [
              207.75,
              198.104,
              185.5
            ],
            "nightReferenceSigma": 1.576
          },
          {
            "x": 485,
            "y": 848,
            "width": 6,
            "height": 8,
            "reference": [
              138.458,
              118.938,
              90.792
            ],
            "referenceSigma": 1.208,
            "nightReference": [
              200.229,
              191.5,
              173.188
            ],
            "nightReferenceSigma": 1.093
          },
          {
            "x": 485,
            "y": 878,
            "width": 6,
            "height": 8,
            "reference": [
              138.104,
              116.125,
              88.0
            ],
            "referenceSigma": 1.015,
            "nightReference": [
              198.875,
              188.083,
              172.5
            ],
            "nightReferenceSigma": 2.344
          },
          {
            "x": 411,
            "y": 805,
            "width": 10,
            "height": 6,
            "reference": [
              149.617,
              120.617,
              78.45
            ],
            "referenceSigma": 1.023,
            "nightReference": [
              207.967,
              194.65,
              174.55
            ],
            "nightReferenceSigma": 2.242
          }
        ]
      }
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
      ],
      "edgeBlend": {
        "aperture": [
          [
            430,
            1057
          ],
          [
            515,
            1027
          ],
          [
            551,
            1155
          ],
          [
            458,
            1155
          ]
        ],
        "innerWidth": 12,
        "minY": 1062,
        "samples": [
          {
            "x": 420,
            "y": 1062,
            "width": 6,
            "height": 6,
            "reference": [
              121.028,
              94.194,
              44.472
            ],
            "referenceSigma": 12.433,
            "nightReference": [
              165.417,
              157.722,
              136.0
            ],
            "nightReferenceSigma": 8.829
          },
          {
            "x": 422,
            "y": 1070,
            "width": 6,
            "height": 6,
            "reference": [
              115.194,
              89.556,
              47.417
            ],
            "referenceSigma": 12.736,
            "nightReference": [
              161.583,
              151.417,
              130.444
            ],
            "nightReferenceSigma": 10.676
          }
        ]
      }
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

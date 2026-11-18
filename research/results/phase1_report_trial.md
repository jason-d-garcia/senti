# Phase 1 results: cross-modal emotion representations

1 seed(s); mean ± sd over seeds. Probe r on the MERGE test songs. Config: {'d': 256, 'layers': 2, 'lr': 0.0003, 'epochs': 2, 'p_drop': 0.25, 'n_boot': 100, 'n_rand': 5, 'edit_layer': 0}

## Mid-fusion model: probe transfer by layer (raw shared space)

Layer 0 = mean of projected input tokens before any fusion; layers 1-2 = CLS after each fusion layer.


**valence**

| net | layer | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics | shuffled | independence |
|---|---|---|---|---|---|---|---|
| trained | 0 | 0.71 ± 0.00 | 0.65 ± 0.00 | 0.48 ± 0.00 | 0.64 ± 0.00 | -0.34 ± 0.00 | 0.82 ± 0.00 |
| trained | 1 | 0.69 ± 0.00 | 0.65 ± 0.00 | 0.43 ± 0.00 | 0.46 ± 0.00 | 0.00 ± 0.00 | 0.66 ± 0.00 |
| trained | 2 | 0.69 ± 0.00 | 0.65 ± 0.00 | 0.48 ± 0.00 | 0.54 ± 0.00 | -0.33 ± 0.00 | 0.76 ± 0.00 |
| untrained | 0 | 0.71 ± 0.00 | 0.65 ± 0.00 | 0.12 ± 0.00 | -0.20 ± 0.00 | 0.06 ± 0.00 | -0.04 ± 0.00 |
| untrained | 1 | 0.72 ± 0.00 | 0.64 ± 0.00 | -0.03 ± 0.00 | 0.07 ± 0.00 | -0.10 ± 0.00 | 0.02 ± 0.00 |
| untrained | 2 | 0.72 ± 0.00 | 0.61 ± 0.00 | 0.16 ± 0.00 | 0.36 ± 0.00 | -0.22 ± 0.00 | 0.38 ± 0.00 |

**arousal**

| net | layer | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics | shuffled | independence |
|---|---|---|---|---|---|---|---|
| trained | 0 | 0.58 ± 0.00 | 0.74 ± 0.00 | 0.39 ± 0.00 | 0.52 ± 0.00 | 0.25 ± 0.00 | 0.70 ± 0.00 |
| trained | 1 | 0.57 ± 0.00 | 0.73 ± 0.00 | 0.45 ± 0.00 | 0.46 ± 0.00 | 0.29 ± 0.00 | 0.71 ± 0.00 |
| trained | 2 | 0.58 ± 0.00 | 0.74 ± 0.00 | 0.58 ± 0.00 | 0.44 ± 0.00 | -0.05 ± 0.00 | 0.78 ± 0.00 |
| untrained | 0 | 0.58 ± 0.00 | 0.74 ± 0.00 | -0.39 ± 0.00 | -0.02 ± 0.00 | -0.08 ± 0.00 | -0.28 ± 0.00 |
| untrained | 1 | 0.56 ± 0.00 | 0.72 ± 0.00 | -0.30 ± 0.00 | 0.16 ± 0.00 | -0.09 ± 0.00 | -0.07 ± 0.00 |
| untrained | 2 | 0.57 ± 0.00 | 0.71 ± 0.00 | -0.05 ± 0.00 | 0.09 ± 0.00 | 0.09 ± 0.00 | 0.04 ± 0.00 |

## Same, after label-free CCA alignment (comparable with late fusion)


**valence**

| model / layer | lyrics→audio | audio→lyrics | independence |
|---|---|---|---|
| mid fusion L0 | 0.59 ± 0.00 | 0.69 ± 0.00 | 0.97 ± 0.00 |
| mid fusion L1 | 0.57 ± 0.00 | 0.68 ± 0.00 | 0.95 ± 0.00 |
| mid fusion L2 | 0.56 ± 0.00 | 0.67 ± 0.00 | 0.96 ± 0.00 |
| Senti late bert0_mert0 | 0.45 | 0.57 | 0.97 |
| Senti late bert0_mert3 | 0.55 | 0.59 | 0.96 |
| Senti late bert0_mert6 | 0.61 | 0.61 | 0.97 |
| Senti late bert0_mert9 | 0.61 | 0.59 | 0.96 |
| Senti late bert0_mert12 | 0.53 | 0.54 | 0.97 |
| Senti late bert4_mert0 | 0.46 | 0.62 | 0.94 |
| Senti late bert4_mert3 | 0.59 | 0.66 | 0.96 |
| Senti late bert4_mert6 | 0.63 | 0.65 | 0.96 |
| Senti late bert4_mert9 | 0.62 | 0.65 | 0.97 |
| Senti late bert4_mert12 | 0.52 | 0.62 | 0.95 |
| Senti late bert8_mert0 | 0.46 | 0.61 | 0.96 |
| Senti late bert8_mert3 | 0.60 | 0.66 | 0.98 |
| Senti late bert8_mert6 | 0.62 | 0.66 | 0.98 |
| Senti late bert8_mert9 | 0.62 | 0.67 | 0.98 |
| Senti late bert8_mert12 | 0.54 | 0.59 | 0.98 |
| Senti late bert12_mert0 | 0.45 | 0.64 | 0.97 |
| Senti late bert12_mert3 | 0.59 | 0.67 | 0.99 |
| Senti late bert12_mert6 | 0.63 | 0.68 | 0.98 |
| Senti late bert12_mert9 | 0.61 | 0.67 | 0.97 |
| Senti late bert12_mert12 | 0.57 | 0.59 | 1.00 |

**arousal**

| model / layer | lyrics→audio | audio→lyrics | independence |
|---|---|---|---|
| mid fusion L0 | 0.73 ± 0.00 | 0.61 ± 0.00 | 1.00 ± 0.00 |
| mid fusion L1 | 0.73 ± 0.00 | 0.60 ± 0.00 | 1.01 ± 0.00 |
| mid fusion L2 | 0.73 ± 0.00 | 0.61 ± 0.00 | 1.01 ± 0.00 |
| Senti late bert0_mert0 | 0.65 | 0.50 | 0.98 |
| Senti late bert0_mert3 | 0.68 | 0.53 | 0.99 |
| Senti late bert0_mert6 | 0.72 | 0.53 | 0.98 |
| Senti late bert0_mert9 | 0.72 | 0.53 | 0.99 |
| Senti late bert0_mert12 | 0.65 | 0.55 | 0.98 |
| Senti late bert4_mert0 | 0.65 | 0.56 | 0.96 |
| Senti late bert4_mert3 | 0.68 | 0.57 | 0.97 |
| Senti late bert4_mert6 | 0.72 | 0.59 | 0.98 |
| Senti late bert4_mert9 | 0.70 | 0.59 | 0.99 |
| Senti late bert4_mert12 | 0.65 | 0.58 | 0.97 |
| Senti late bert8_mert0 | 0.66 | 0.57 | 0.99 |
| Senti late bert8_mert3 | 0.69 | 0.58 | 0.99 |
| Senti late bert8_mert6 | 0.72 | 0.57 | 0.99 |
| Senti late bert8_mert9 | 0.70 | 0.58 | 0.99 |
| Senti late bert8_mert12 | 0.66 | 0.58 | 1.00 |
| Senti late bert12_mert0 | 0.69 | 0.62 | 1.01 |
| Senti late bert12_mert3 | 0.72 | 0.63 | 1.00 |
| Senti late bert12_mert6 | 0.74 | 0.63 | 1.01 |
| Senti late bert12_mert9 | 0.71 | 0.63 | 1.01 |
| Senti late bert12_mert12 | 0.68 | 0.63 | 1.01 |

## Intervention on the shared valence direction (after fusion layer 1)

| input | edit | valence r | arousal r | mean abs Δvalence | mean abs Δarousal | mean Δvalence |
|---|---|---|---|---|---|---|
| both | ablate_valence_dir | 0.70 ± 0.00 | 0.58 ± 0.00 | 0.013 ± 0.000 | 0.003 ± 0.000 | -0.013 ± 0.000 |
| both | ablate_random_mean | 0.70 ± 0.00 | 0.58 ± 0.00 | 0.005 ± 0.000 | 0.003 ± 0.000 | -0.003 ± 0.000 |
| both | steer_plus2 | 0.70 ± 0.00 | 0.58 ± 0.00 | 0.009 ± 0.000 | 0.002 ± 0.000 | 0.009 ± 0.000 |
| both | steer_minus2 | 0.70 ± 0.00 | 0.58 ± 0.00 | 0.009 ± 0.000 | 0.002 ± 0.000 | -0.009 ± 0.000 |
| text | ablate_valence_dir | 0.70 ± 0.00 | 0.58 ± 0.00 | 0.013 ± 0.000 | 0.003 ± 0.000 | -0.013 ± 0.000 |
| text | ablate_random_mean | 0.70 ± 0.00 | 0.57 ± 0.00 | 0.005 ± 0.000 | 0.004 ± 0.000 | -0.003 ± 0.000 |
| text | steer_plus2 | 0.70 ± 0.00 | 0.58 ± 0.00 | 0.009 ± 0.000 | 0.002 ± 0.000 | 0.009 ± 0.000 |
| text | steer_minus2 | 0.70 ± 0.00 | 0.58 ± 0.00 | 0.009 ± 0.000 | 0.002 ± 0.000 | -0.009 ± 0.000 |
| audio | ablate_valence_dir | 0.55 ± 0.00 | 0.63 ± 0.00 | 0.014 ± 0.000 | 0.004 ± 0.000 | -0.014 ± 0.000 |
| audio | ablate_random_mean | 0.55 ± 0.00 | 0.63 ± 0.00 | 0.011 ± 0.000 | 0.016 ± 0.000 | 0.006 ± 0.000 |
| audio | steer_plus2 | 0.55 ± 0.00 | 0.63 ± 0.00 | 0.010 ± 0.000 | 0.002 ± 0.000 | 0.010 ± 0.000 |
| audio | steer_minus2 | 0.55 ± 0.00 | 0.63 ± 0.00 | 0.010 ± 0.000 | 0.002 ± 0.000 | -0.010 ± 0.000 |

## Prediction quality and conflict songs (valence)


**all_test** (n = 206)

| model | valence r | valence MAE |
|---|---|---|
| lyrics only (Senti BERT) | 0.72 | 0.223 |
| audio only (Senti frozen MERT) | 0.68 | 0.276 |
| Senti late fusion (live) | 0.77 | 0.219 |
| mid fusion, both | 0.70 | 0.247 |
| mid fusion, lyrics only | 0.70 | 0.250 |
| mid fusion, audio only | 0.55 | 0.362 |

**conflict** (n = 51)

| model | valence r | valence MAE |
|---|---|---|
| lyrics only (Senti BERT) | 0.45 | 0.328 |
| audio only (Senti frozen MERT) | 0.42 | 0.380 |
| Senti late fusion (live) | 0.68 | 0.282 |
| mid fusion, both | 0.49 | 0.338 |
| mid fusion, lyrics only | 0.49 | 0.342 |
| mid fusion, audio only | 0.23 | 0.414 |

Mid-fusion performance by input: {'both': {'valence_r': [0.7047295506359198, 0.0], 'arousal_r': [0.5810903310580137, 0.0], 'valence_mae': [0.24703797698020935, 0.0], 'arousal_mae': [0.1642044633626938, 0.0]}, 'text': {'valence_r': [0.7032075737579937, 0.0], 'arousal_r': [0.5763937574966457, 0.0], 'valence_mae': [0.2495194524526596, 0.0], 'arousal_mae': [0.16363179683685303, 0.0]}, 'audio': {'valence_r': [0.5546802898216493, 0.0], 'arousal_r': [0.628843541574387, 0.0], 'valence_mae': [0.36198705434799194, 0.0], 'arousal_mae': [0.1573808342218399, 0.0]}}


Conflict-song ablation per seed: [{'n': 51, 'valence_r': 0.49197010146729314, 'valence_mae': 0.3376065492630005, 'ablated_valence_r': 0.49193165721167625, 'ablated_mean_abs_dv': 0.014480282552540302}]

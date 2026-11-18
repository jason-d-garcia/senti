# Phase 1 results: cross-modal emotion representations

3 seed(s); mean ± sd over seeds. Probe r on the MERGE test songs. Config: {'d': 256, 'layers': 2, 'lr': 0.0003, 'epochs': 40, 'p_drop': 0.25, 'n_boot': 1000, 'n_rand': 20, 'edit_layer': 0}

## Mid-fusion model: probe transfer by layer (raw shared space)

Layer 0 = mean of projected input tokens before any fusion; layers 1-2 = CLS after each fusion layer.


**valence**

| net | layer | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics | shuffled | independence |
|---|---|---|---|---|---|---|---|
| trained | 0 | 0.69 ± 0.00 | 0.67 ± 0.00 | 0.65 ± 0.01 | 0.68 ± 0.02 | 0.11 ± 0.45 | 0.98 ± 0.02 |
| trained | 1 | 0.68 ± 0.00 | 0.70 ± 0.00 | 0.68 ± 0.00 | 0.66 ± 0.02 | 0.22 ± 0.11 | 0.97 ± 0.02 |
| trained | 2 | 0.68 ± 0.00 | 0.70 ± 0.00 | 0.68 ± 0.01 | 0.67 ± 0.01 | 0.05 ± 0.14 | 0.98 ± 0.01 |
| untrained | 0 | 0.70 ± 0.01 | 0.65 ± 0.02 | 0.03 ± 0.13 | -0.10 ± 0.15 | 0.13 ± 0.12 | -0.05 ± 0.18 |
| untrained | 1 | 0.69 ± 0.02 | 0.64 ± 0.02 | -0.09 ± 0.12 | 0.21 ± 0.22 | 0.03 ± 0.08 | 0.08 ± 0.24 |
| untrained | 2 | 0.70 ± 0.01 | 0.62 ± 0.02 | -0.02 ± 0.13 | 0.28 ± 0.07 | -0.06 ± 0.14 | 0.19 ± 0.14 |

**arousal**

| net | layer | lyrics→lyrics | audio→audio | lyrics→audio | audio→lyrics | shuffled | independence |
|---|---|---|---|---|---|---|---|
| trained | 0 | 0.58 ± 0.00 | 0.74 ± 0.00 | 0.72 ± 0.01 | 0.57 ± 0.01 | 0.20 ± 0.19 | 0.98 ± 0.01 |
| trained | 1 | 0.56 ± 0.01 | 0.76 ± 0.00 | 0.73 ± 0.01 | 0.51 ± 0.03 | -0.27 ± 0.21 | 0.94 ± 0.02 |
| trained | 2 | 0.56 ± 0.00 | 0.76 ± 0.00 | 0.73 ± 0.01 | 0.49 ± 0.04 | 0.12 ± 0.49 | 0.93 ± 0.04 |
| untrained | 0 | 0.58 ± 0.00 | 0.73 ± 0.01 | 0.06 ± 0.32 | 0.24 ± 0.19 | 0.07 ± 0.07 | 0.25 ± 0.38 |
| untrained | 1 | 0.57 ± 0.01 | 0.72 ± 0.01 | 0.08 ± 0.28 | 0.15 ± 0.13 | 0.14 ± 0.18 | 0.19 ± 0.19 |
| untrained | 2 | 0.57 ± 0.00 | 0.72 ± 0.00 | 0.03 ± 0.30 | 0.16 ± 0.05 | -0.09 ± 0.07 | 0.16 ± 0.22 |

## Same, after label-free CCA alignment (comparable with late fusion)


**valence**

| model / layer | lyrics→audio | audio→lyrics | independence |
|---|---|---|---|
| mid fusion L0 | 0.63 ± 0.02 | 0.69 ± 0.01 | 0.98 ± 0.00 |
| mid fusion L1 | 0.65 ± 0.00 | 0.66 ± 0.00 | 0.99 ± 0.00 |
| mid fusion L2 | 0.65 ± 0.00 | 0.67 ± 0.00 | 0.99 ± 0.00 |
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
| mid fusion L0 | 0.73 ± 0.01 | 0.61 ± 0.00 | 1.00 ± 0.00 |
| mid fusion L1 | 0.74 ± 0.01 | 0.58 ± 0.01 | 1.00 ± 0.00 |
| mid fusion L2 | 0.74 ± 0.01 | 0.59 ± 0.01 | 1.01 ± 0.00 |
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
| both | ablate_valence_dir | 0.71 ± 0.00 | 0.65 ± 0.03 | 0.032 ± 0.026 | 0.003 ± 0.001 | -0.008 ± 0.006 |
| both | ablate_random_mean | 0.71 ± 0.00 | 0.65 ± 0.03 | 0.009 ± 0.001 | 0.009 ± 0.001 | -0.000 ± 0.002 |
| both | steer_plus2 | 0.71 ± 0.00 | 0.65 ± 0.03 | 0.070 ± 0.060 | 0.007 ± 0.003 | 0.070 ± 0.060 |
| both | steer_minus2 | 0.71 ± 0.00 | 0.65 ± 0.03 | 0.069 ± 0.060 | 0.007 ± 0.003 | -0.069 ± 0.060 |
| text | ablate_valence_dir | 0.68 ± 0.00 | 0.56 ± 0.01 | 0.032 ± 0.026 | 0.003 ± 0.001 | -0.005 ± 0.007 |
| text | ablate_random_mean | 0.68 ± 0.00 | 0.56 ± 0.02 | 0.008 ± 0.001 | 0.009 ± 0.001 | -0.001 ± 0.003 |
| text | steer_plus2 | 0.68 ± 0.00 | 0.56 ± 0.02 | 0.070 ± 0.060 | 0.007 ± 0.003 | 0.070 ± 0.060 |
| text | steer_minus2 | 0.68 ± 0.00 | 0.56 ± 0.02 | 0.069 ± 0.060 | 0.007 ± 0.003 | -0.069 ± 0.060 |
| audio | ablate_valence_dir | 0.67 ± 0.01 | 0.75 ± 0.01 | 0.028 ± 0.021 | 0.003 ± 0.001 | -0.003 ± 0.008 |
| audio | ablate_random_mean | 0.68 ± 0.01 | 0.75 ± 0.01 | 0.009 ± 0.002 | 0.009 ± 0.001 | 0.001 ± 0.002 |
| audio | steer_plus2 | 0.68 ± 0.01 | 0.75 ± 0.01 | 0.071 ± 0.061 | 0.008 ± 0.003 | 0.071 ± 0.061 |
| audio | steer_minus2 | 0.68 ± 0.01 | 0.75 ± 0.01 | 0.070 ± 0.060 | 0.008 ± 0.003 | -0.070 ± 0.060 |

## Prediction quality and conflict songs (valence)


**all_test** (n = 206)

| model | valence r | valence MAE |
|---|---|---|
| lyrics only (Senti BERT) | 0.72 | 0.223 |
| audio only (Senti frozen MERT) | 0.68 | 0.276 |
| Senti late fusion (live) | 0.77 | 0.219 |
| mid fusion, both | 0.71 | 0.233 |
| mid fusion, lyrics only | 0.69 | 0.241 |
| mid fusion, audio only | 0.69 | 0.272 |

**conflict** (n = 51)

| model | valence r | valence MAE |
|---|---|---|
| lyrics only (Senti BERT) | 0.45 | 0.328 |
| audio only (Senti frozen MERT) | 0.42 | 0.380 |
| Senti late fusion (live) | 0.68 | 0.282 |
| mid fusion, both | 0.50 | 0.325 |
| mid fusion, lyrics only | 0.45 | 0.342 |
| mid fusion, audio only | 0.45 | 0.384 |

Mid-fusion performance by input: {'both': {'valence_r': [0.7091528078433981, 0.0034820744386965014], 'arousal_r': [0.6516916572091336, 0.03319182443228499], 'valence_mae': [0.23630796372890472, 0.0034637578893222535], 'arousal_mae': [0.157957062125206, 0.01053712864775425]}, 'text': {'valence_r': [0.684594525754643, 0.0013902553498181917], 'arousal_r': [0.5607516396518221, 0.016641043278344543], 'valence_mae': [0.24558251599470773, 0.002707796768963368], 'arousal_mae': [0.1734047830104828, 0.0053290536705043]}, 'audio': {'valence_r': [0.6773825492522155, 0.008170767034672148], 'arousal_r': [0.7466335750474862, 0.00606102599472281], 'valence_mae': [0.2757698396841685, 0.01014628397204596], 'arousal_mae': [0.16246792674064636, 0.018717129826896654]}}


Conflict-song ablation per seed: [{'n': 51, 'valence_r': 0.5190403051150125, 'valence_mae': 0.32170799374580383, 'ablated_valence_r': 0.5195256958404696, 'ablated_mean_abs_dv': 0.010679350234568119}, {'n': 51, 'valence_r': 0.5055826436935207, 'valence_mae': 0.3204759955406189, 'ablated_valence_r': 0.5075363339056864, 'ablated_mean_abs_dv': 0.06471600383520126}, {'n': 51, 'valence_r': 0.48110912709166176, 'valence_mae': 0.337815523147583, 'ablated_valence_r': 0.4807239834899201, 'ablated_mean_abs_dv': 0.019753077998757362}]

# DR model performance results

## Evaluation setup

These are the recorded outputs from the **official IDRiD Disease Grading test set (103 images)** in [`ml/reports/idrid_grading_test_eval.json`](../ml/reports/idrid_grading_test_eval.json). Both classifiers were trained on APTOS 2019, so IDRiD is an external, cross-dataset evaluatiocn. The test grade distribution is 0: 34, 1: 5, 2: 32, 3: 19, 4: 13.

The values below are test-set results, not simulated demo outputs. They are research results and do not establish clinical validity.

## EfficientNet-B4 — any DR vs no DR

Positive means reference grade ≥1; predicted positive at P(DR) ≥0.5. ROC AUC is computed from continuous P(DR).

| Metric | Result |
|---|---:|
| ROC AUC | 0.870 |
| Accuracy | 72.8% |
| Sensitivity | 94.2% |
| Specificity | 29.4% |
| PPV | 73.0% |
| NPV | 71.4% |

Confusion matrix (rows = reference, columns = predicted):

| | Predicted no DR | Predicted DR |
|---|---:|---:|
| **Reference no DR** | 10 (TN) | 24 (FP) |
| **Reference DR** | 4 (FN) | 65 (TP) |

## ViT-S/16 — five-class grade

| Metric | Result |
|---|---:|
| Accuracy | 41.7% |
| Macro-F1 | 0.348 |
| Quadratic weighted kappa | 0.490 |

Confusion matrix (rows = reference grade, columns = predicted grade):

| Reference \ Predicted | Grade 0 | Grade 1 | Grade 2 | Grade 3 | Grade 4 |
|---|---:|---:|---:|---:|---:|
| **Grade 0** | 12 | 4 | 14 | 0 | 4 |
| **Grade 1** | 1 | 2 | 2 | 0 | 0 |
| **Grade 2** | 2 | 2 | 20 | 0 | 8 |
| **Grade 3** | 1 | 1 | 4 | 1 | 12 |
| **Grade 4** | 0 | 0 | 5 | 0 | 8 |

## ViT-S/16 — thresholded decisions from the same evaluation

The model's grade probabilities also support binary tasks. These figures do not replace the five-class confusion matrix.

| Task | ROC AUC | Threshold | Sensitivity | Specificity | Accuracy | TP / FP / TN / FN |
|---|---:|---:|---:|---:|---:|---|
| Any DR (grade ≥1) | 0.895 | Argmax grade ≥1 | 94.2% | 35.3% | 74.8% | 65 / 22 / 12 / 4 |
| Referable DR (grade ≥2) | 0.897 | Score ≥0.5 | 90.6% | 56.4% | 77.7% | 58 / 17 / 22 / 6 |

## Interpretation and limitations

- EfficientNet-B4 has high sensitivity but low specificity on this external test set: it flagged 24 of 34 grade-0 images as DR at the 0.5 threshold.
- ViT-S/16's five-class accuracy is 41.7%; severe NPDR (grade 3) is often predicted as proliferative DR.
- The report JSON contains per-image scores and predictions for reproducing additional plots, including ROC curves.
- These test results are from public datasets and are not clinical validation or regulatory clearance.

## Reviewer A: uncertainty ##

> How variable are the gains over random seeds?

We reran all methods on the same five splits. Each entry reports the mean and sample SD. No test labels were used to select the checkpoint.

| Method                | AUROC $\uparrow$      | Macro F1 $\uparrow$   |
| :-------------------- | -------------------: | -------------------: |
| ERM                   | 88.2 $\pm$ 0.6       | 80.9 $\pm$ 0.7       |
| Group DRO             | 89.8 $\pm$ 0.4       | 82.7 $\pm$ 0.5       |
| Ours                  | 91.2 $\pm$ 0.3       | 84.1 $\pm$ 0.4       |

The [per-seed scores](https://example.org/artifacts/rebuttal/seeds-and-splits) and [split IDs](https://example.org/artifacts/rebuttal/seeds-and-splits) are in the same archive.


## Reviewer B: objective ##

> Please specify the weighting and the bound.

We fit $ L = a + b $ with $a_{i}$ estimated from the training split. We used $\frac{1}{N}$ for each sample's weight. The following bound holds for each held-out group:

$$\begin{align}e & = u + v\end{align}$$

It requires $a\leq b$ when the calibration set is small. The ablation below keeps the backbone fixed.

| Variant        | AUROC $\uparrow$ | Extra hours |
| -------------- | ---------------: | ----------: |
| No weights     | 89.7             |             |
| Fixed weights  | 90.1             | 0.2         |
| Learned        | 91.2             | 0.4         |

## Reviewer C: calibration ##

> Does the order of the baselines depend on temperature?

We swept five temperatures on validation and froze the best one. See <https://example.org/calibration> for all curves. At $T=2$ the gap is still 0.7 points. The table above uses $T=1$.

## Reviewer D: latency ##

> Please report the hardware and check the implementation.

All methods used one A100. The release records `` timing.py ``, the CUDA version, and the batch size. For the exact invocation see [https://example.org/timing](https://example.org/timing). The measured overhead is 2.1&plusmn;0.2 ms.

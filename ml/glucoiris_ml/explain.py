"""Grad-CAM for Vision Transformers (Selvaraju et al. 2017, adapted to patch tokens).

Activations and gradients are taken at the input of the final block's attention
(`blocks[-1].norm1`), the class/prefix tokens are dropped and the patch tokens are
reshaped to the 14×14 grid. The map shows regions associated with the chosen
class score — it is NOT a lesion detector or proof of causality (spec §7.4).
"""
from __future__ import annotations

import numpy as np
import torch


class ViTGradCAM:
    def __init__(self, model: torch.nn.Module):
        self.model = model
        self.acts = None
        self.grads = None
        layer = model.blocks[-1].norm1
        layer.register_forward_hook(self._fwd)
        layer.register_full_backward_hook(self._bwd)
        self.prefix = getattr(model, "num_prefix_tokens", 1)

    def _fwd(self, _m, _i, out):
        self.acts = out

    def _bwd(self, _m, _gi, go):
        self.grads = go[0]

    def __call__(self, x: torch.Tensor, target: int | None = None) -> tuple[np.ndarray, torch.Tensor]:
        """Returns (heatmap HxW in [0,1] at patch-grid resolution, logits)."""
        self.model.zero_grad(set_to_none=True)
        x = x.requires_grad_(True)
        logits = self.model(x)
        cls = int(logits.argmax(1)) if target is None else target
        logits[0, cls].backward()
        a = self.acts[0, self.prefix :].detach()  # (N, C)
        g = self.grads[0, self.prefix :].detach()
        n = int(round(a.shape[0] ** 0.5))
        w = g.mean(0)  # channel weights
        cam = torch.relu((a * w).sum(-1)).reshape(n, n).cpu().numpy()
        cam = cam / (cam.max() + 1e-8)
        return cam, logits.detach()

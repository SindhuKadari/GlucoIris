"""Model architectures: U-Net (vessels), ResNet34-U-Net (lesions), ViT (DR grade)."""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

DR_CLASSES = ["No DR", "Mild NPDR", "Moderate NPDR", "Severe NPDR", "Proliferative DR"]
LESION_CLASSES = ["microaneurysms", "haemorrhages", "hard_exudates", "soft_exudates"]


class ConvBlock(nn.Module):
    def __init__(self, cin: int, cout: int, drop: float = 0.0):
        super().__init__()
        self.net = nn.Sequential(
            nn.Conv2d(cin, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
            nn.Dropout2d(drop) if drop else nn.Identity(),
            nn.Conv2d(cout, cout, 3, padding=1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
        )

    def forward(self, x):
        return self.net(x)


class UNet(nn.Module):
    """Compact U-Net (Ronneberger et al. 2015) for retinal vessel segmentation."""

    def __init__(self, in_ch: int = 1, out_ch: int = 1, base: int = 16, depth: int = 4, drop: float = 0.1):
        super().__init__()
        chs = [base * 2**i for i in range(depth + 1)]
        self.downs = nn.ModuleList()
        c = in_ch
        for ch in chs[:-1]:
            self.downs.append(ConvBlock(c, ch, drop))
            c = ch
        self.bottom = ConvBlock(chs[-2], chs[-1], drop)
        self.ups = nn.ModuleList()
        for ch in reversed(chs[:-1]):
            self.ups.append(ConvBlock(ch * 2 + ch, ch, drop))
        self.head = nn.Conv2d(chs[0], out_ch, 1)
        self.depth = depth

    def forward(self, x):
        skips = []
        for d in self.downs:
            x = d(x)
            skips.append(x)
            x = F.max_pool2d(x, 2)
        x = self.bottom(x)
        for up, s in zip(self.ups, reversed(skips)):
            x = F.interpolate(x, size=s.shape[-2:], mode="bilinear", align_corners=False)
            x = up(torch.cat([x, s], 1))
        return self.head(x)


class ResUNet(nn.Module):
    """U-Net decoder on a torchvision ResNet34 encoder, for multi-label lesion masks."""

    def __init__(self, out_ch: int = len(LESION_CLASSES), pretrained: bool = True):
        super().__init__()
        import torchvision

        weights = torchvision.models.ResNet34_Weights.IMAGENET1K_V1 if pretrained else None
        r = torchvision.models.resnet34(weights=weights)
        self.stem = nn.Sequential(r.conv1, r.bn1, r.relu)  # /2, 64
        self.pool = r.maxpool  # /4
        self.e1, self.e2, self.e3, self.e4 = r.layer1, r.layer2, r.layer3, r.layer4  # 64,128,256,512
        self.d4 = ConvBlock(512 + 256, 256)
        self.d3 = ConvBlock(256 + 128, 128)
        self.d2 = ConvBlock(128 + 64, 64)
        self.d1 = ConvBlock(64 + 64, 64)
        self.d0 = ConvBlock(64 + 3, 32)
        self.head = nn.Conv2d(32, out_ch, 1)

    @staticmethod
    def _up(x, ref):
        return F.interpolate(x, size=ref.shape[-2:], mode="bilinear", align_corners=False)

    def forward(self, x):
        s0 = self.stem(x)
        e1 = self.e1(self.pool(s0))
        e2 = self.e2(e1)
        e3 = self.e3(e2)
        e4 = self.e4(e3)
        d = self.d4(torch.cat([self._up(e4, e3), e3], 1))
        d = self.d3(torch.cat([self._up(d, e2), e2], 1))
        d = self.d2(torch.cat([self._up(d, e1), e1], 1))
        d = self.d1(torch.cat([self._up(d, s0), s0], 1))
        d = self.d0(torch.cat([self._up(d, x), x], 1))
        return self.head(d)


def build_vit(name: str = "vit_base_patch16_224.augreg_in21k_ft_in1k", num_classes: int = 5, pretrained: bool = True, drop_path: float = 0.1):
    """Vision Transformer classifier from timm (ImageNet-21k pre-trained by default)."""
    import timm

    return timm.create_model(name, pretrained=pretrained, num_classes=num_classes, drop_path_rate=drop_path)

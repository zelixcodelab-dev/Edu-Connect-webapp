import React, { useRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Printer, DownloadSimple, QrCode } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const esc = (v) => String(v || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function posterHtml({ qr, url, name, logo, color }) {
  const mark = logo
    ? `<img src="${esc(logo)}" class="logo" alt="">`
    : `<div class="logo mono" style="background:${esc(color)}">${esc((name || "?").charAt(0).toUpperCase())}</div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Apply · ${esc(name)}</title>
<style>
@page{size:A5;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{margin:0 auto;width:148mm;height:210mm;padding:14mm 14mm;display:flex;flex-direction:column;align-items:center;text-align:center;border-top:7mm solid ${esc(color)};overflow:hidden}
.logo{width:18mm;height:18mm;object-fit:contain;border-radius:4mm}.mono{display:flex;align-items:center;justify-content:center;color:#fff;font-size:10mm;font-weight:700}
.name{font-size:6.5mm;font-weight:700;margin-top:4mm;letter-spacing:-.15mm}.eyebrow{margin-top:8mm;font-size:3mm;letter-spacing:.9mm;text-transform:uppercase;color:#666}
h1{font-size:8mm;line-height:1.1;margin:2.5mm 0 0;letter-spacing:-.2mm}.sub{font-size:3.6mm;color:#555;margin-top:3mm}
.qr{margin-top:8mm;padding:4mm;border:1mm solid ${esc(color)};border-radius:6mm}.qr img{width:62mm;height:62mm;display:block}
.cta{margin-top:6mm;font-size:5mm;font-weight:700;color:${esc(color)}}.url{margin-top:2mm;font-size:3.2mm;color:#444;word-break:break-all}
</style></head><body><div class="page">${mark}<div class="name">${esc(name)}</div>
<div class="eyebrow">Admissions open</div><h1>Apply online in 5 minutes</h1><div class="sub">Scan the code with your phone camera to start your application.</div>
<div class="qr"><img src="${qr}" alt="QR code"></div><div class="cta">Scan to apply</div><div class="url">${esc(url)}</div></div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`;
}

// QR for a company's public application link, with A5 poster print + PNG download.
export function ApplyQrDialog({ url, name, logo, color = "#111111", trigger, testId = "apply-qr" }) {
  const canvasRef = useRef(null);
  const dataUrl = () => canvasRef.current?.toDataURL("image/png");

  const print = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(posterHtml({ qr: dataUrl(), url, name, logo, color }));
    w.document.close();
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = dataUrl();
    a.download = `${(name || "apply").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-application-qr.png`;
    a.click();
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-1.5" data-testid={`${testId}-open`}>
            <QrCode size={15} /> QR code
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-sm" data-testid={`${testId}-dialog`}>
        <DialogHeader className="text-left">
          <DialogTitle className="font-display">Application QR code</DialogTitle>
          <DialogDescription>Students scan this to open {name ? `${name}'s` : "the"} application form.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3 py-2">
          <div className="p-4 rounded-2xl bg-white border-2" style={{ borderColor: color }}>
            <QRCodeCanvas value={url} size={208} marginSize={1} level="M" data-testid={`${testId}-canvas`} />
            <QRCodeCanvas ref={canvasRef} value={url} size={1024} marginSize={1} level="M" className="hidden" aria-hidden />
          </div>
          <p className="text-xs text-muted-foreground text-center break-all" data-testid={`${testId}-url`}>{url}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={print} className="gap-1.5" data-testid={`${testId}-print`}><Printer size={15} /> Print poster</Button>
          <Button variant="outline" onClick={download} className="gap-1.5" data-testid={`${testId}-download`}><DownloadSimple size={15} /> PNG</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

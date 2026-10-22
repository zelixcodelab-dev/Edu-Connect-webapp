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
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#111;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.page{margin:0 auto;width:210mm;height:297mm;padding:22mm 20mm;display:flex;flex-direction:column;align-items:center;text-align:center;border-top:10mm solid ${esc(color)}}
.logo{width:26mm;height:26mm;object-fit:contain;border-radius:5mm}.mono{display:flex;align-items:center;justify-content:center;color:#fff;font-size:14mm;font-weight:700}
.name{font-size:9mm;font-weight:700;margin-top:6mm;letter-spacing:-.2mm}.eyebrow{margin-top:14mm;font-size:4mm;letter-spacing:1.2mm;text-transform:uppercase;color:#666}
h1{font-size:17mm;line-height:1.02;margin:4mm 0 0;letter-spacing:-.6mm}.sub{font-size:5mm;color:#555;margin-top:5mm}
.qr{margin-top:12mm;padding:6mm;border:1.2mm solid ${esc(color)};border-radius:8mm}.qr img{width:88mm;height:88mm;display:block}
.cta{margin-top:9mm;font-size:7mm;font-weight:700;color:${esc(color)}}.url{margin-top:3mm;font-size:4.2mm;color:#444;word-break:break-all}
</style></head><body><div class="page">${mark}<div class="name">${esc(name)}</div>
<div class="eyebrow">Admissions open</div><h1>Apply online<br>in 5 minutes</h1><div class="sub">Scan the code with your phone camera to start your application.</div>
<div class="qr"><img src="${qr}" alt="QR code"></div><div class="cta">Scan to apply</div><div class="url">${esc(url)}</div></div>
<script>window.onload=function(){setTimeout(function(){window.print()},300)}</script></body></html>`;
}

// QR for a company's public application link, with A4 poster print + PNG download.
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

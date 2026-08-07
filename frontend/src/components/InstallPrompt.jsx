import React, { useState, useEffect } from "react";
import { Download, X, Share, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBranding } from "@/lib/branding";

// PWA install helper. Chrome/Edge/Android: captures `beforeinstallprompt` and
// shows an Install banner. iOS Safari (no install API): shows Add-to-Home-
// Screen instructions. Dismissal is remembered for 24h via localStorage.
export default function InstallPrompt() {
  const { branding } = useBranding();
  const appName = branding?.app_name || "Edu Connect";
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [showInstallButton, setShowInstallButton] = useState(false);
  const [showIOSPrompt, setShowIOSPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Already running as an installed PWA — nothing to do.
    if (window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone) {
      return;
    }

    const dismissedTime = localStorage.getItem("pwa-install-dismissed");
    if (dismissedTime && Date.now() - parseInt(dismissedTime, 10) < 24 * 60 * 60 * 1000) {
      return; // Dismissed within the last 24 hours
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome|CriOS|FxiOS/.test(navigator.userAgent);
    if (isIOS && isSafari) {
      const t = setTimeout(() => setShowIOSPrompt(true), 2000);
      return () => clearTimeout(t);
    }

    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallButton(true);
    };
    const handleInstalled = () => {
      setShowInstallButton(false);
      setDeferredPrompt(null);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setShowInstallButton(false);
  };

  const handleDismiss = () => {
    setShowInstallButton(false);
    setShowIOSPrompt(false);
    setDismissed(true);
    localStorage.setItem("pwa-install-dismissed", Date.now().toString());
  };

  if (dismissed) return null;

  // iOS Safari — manual Add-to-Home-Screen instructions
  if (showIOSPrompt) {
    return (
      <div
        className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-sm bg-card rounded-2xl shadow-2xl border border-border p-4 z-50 animate-slide-up"
        data-testid="ios-install-prompt"
      >
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss install prompt"
          data-testid="ios-install-dismiss"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-start gap-3">
          <div className="w-12 h-12 bg-red-800 rounded-xl flex items-center justify-center flex-shrink-0">
            <img src="/pwa-icon-192.png" alt={appName} className="w-8 h-8 rounded" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-foreground">Install {appName}</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Add to your home screen for quick access
            </p>
          </div>
        </div>

        <div className="mt-4 bg-muted/60 rounded-xl p-3">
          <p className="text-sm text-foreground mb-2">To install:</p>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              1. Tap <Share className="w-4 h-4 text-blue-500" />
            </span>
            <span>at the bottom</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <span className="flex items-center gap-1">
              2. Select <Plus className="w-4 h-4" /> "Add to Home Screen"
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Chrome / Edge / Android — native install prompt
  if (showInstallButton) {
    return (
      <div
        className="fixed bottom-20 left-4 right-4 sm:left-auto sm:right-6 sm:max-w-md bg-gradient-to-r from-red-800 to-red-900 rounded-2xl shadow-2xl p-4 z-50 animate-slide-up"
        data-testid="install-prompt"
      >
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 text-white/70 hover:text-white"
          aria-label="Dismiss install prompt"
          data-testid="install-dismiss"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0">
            <img src="/pwa-icon-192.png" alt={appName} className="w-8 h-8 rounded" />
          </div>
          <div className="flex-1 text-white">
            <h3 className="font-bold">Install {appName}</h3>
            <p className="text-sm text-white/80">Quick access from your home screen</p>
          </div>
          <Button
            onClick={handleInstallClick}
            className="bg-white text-red-800 hover:bg-gray-100 font-semibold px-4"
            data-testid="install-btn"
          >
            <Download className="w-4 h-4 mr-2" />
            Install
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

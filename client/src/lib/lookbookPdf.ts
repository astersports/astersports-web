/**
 * Lookbook PDF Generator
 * Generates a branded PDF presentation with before/after comparison pairs.
 * Uses jsPDF for client-side PDF generation.
 */

import { jsPDF } from "jspdf";

const LOGO_URL = "/manus-storage/aster_sports_logo_high_res_2b537f86.png";

// Brand colors
const BRAND = {
  navy: [10, 14, 26] as [number, number, number],
  gold: [245, 183, 49] as [number, number, number],
  orange: [230, 126, 34] as [number, number, number],
  white: [255, 255, 255] as [number, number, number],
  slate: [148, 163, 184] as [number, number, number],
  darkSlate: [30, 41, 59] as [number, number, number],
};

export interface LookbookItem {
  title: string;
  originalUrl: string;
  resultUrl: string;
  editType: string;
  changes: string;
  creditsUsed: number | null;
  createdAt: Date;
  userName: string;
}

export interface LookbookOptions {
  title?: string;
  subtitle?: string;
  tenantName?: string;
  items: LookbookItem[];
  onProgress?: (current: number, total: number, stage: string) => void;
}

/**
 * Fetches an image and returns it as a base64 data URL
 */
async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Loads an image and returns its dimensions
 */
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => resolve({ width: 1, height: 1 });
    img.src = dataUrl;
  });
}

/**
 * Calculates image dimensions to fit within a box while maintaining aspect ratio
 */
function fitImage(
  imgWidth: number,
  imgHeight: number,
  boxWidth: number,
  boxHeight: number
): { w: number; h: number } {
  const ratio = Math.min(boxWidth / imgWidth, boxHeight / imgHeight);
  return { w: imgWidth * ratio, h: imgHeight * ratio };
}

/**
 * Draws the cover page
 */
function drawCoverPage(
  doc: jsPDF,
  logoBase64: string | null,
  options: LookbookOptions
) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Dark background
  doc.setFillColor(...BRAND.navy);
  doc.rect(0, 0, pageW, pageH, "F");

  // Gold accent line at top
  doc.setFillColor(...BRAND.gold);
  doc.rect(0, 0, pageW, 4, "F");

  // Logo
  if (logoBase64) {
    try {
      doc.addImage(logoBase64, "PNG", pageW / 2 - 20, 60, 40, 40);
    } catch {
      // Skip logo if it fails
    }
  }

  // Title
  doc.setTextColor(...BRAND.white);
  doc.setFontSize(36);
  doc.setFont("helvetica", "bold");
  const title = options.title || "Design Lookbook";
  doc.text(title, pageW / 2, 130, { align: "center" });

  // Subtitle
  doc.setTextColor(...BRAND.slate);
  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  const subtitle = options.subtitle || "Before & After Comparison";
  doc.text(subtitle, pageW / 2, 145, { align: "center" });

  // Tenant/org name
  if (options.tenantName) {
    doc.setTextColor(...BRAND.gold);
    doc.setFontSize(12);
    doc.text(options.tenantName, pageW / 2, 165, { align: "center" });
  }

  // Date and count
  doc.setTextColor(...BRAND.slate);
  doc.setFontSize(10);
  const dateStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  doc.text(`Generated ${dateStr}`, pageW / 2, 185, { align: "center" });
  doc.text(`${options.items.length} design${options.items.length !== 1 ? "s" : ""}`, pageW / 2, 195, { align: "center" });

  // Bottom accent
  doc.setFillColor(...BRAND.gold);
  doc.rect(pageW / 2 - 30, pageH - 30, 60, 2, "F");

  // Footer
  doc.setTextColor(...BRAND.slate);
  doc.setFontSize(8);
  doc.text("Aster Sports · Print Studio", pageW / 2, pageH - 15, { align: "center" });
}

/**
 * Draws a before/after comparison page
 */
function drawComparisonPage(
  doc: jsPDF,
  item: LookbookItem,
  index: number,
  total: number,
  originalBase64: string | null,
  resultBase64: string | null,
  originalDims: { width: number; height: number },
  resultDims: { width: number; height: number }
) {
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 15;

  // Dark background
  doc.setFillColor(...BRAND.navy);
  doc.rect(0, 0, pageW, pageH, "F");

  // Header bar
  doc.setFillColor(...BRAND.darkSlate);
  doc.rect(0, 0, pageW, 35, "F");

  // Title in header
  doc.setTextColor(...BRAND.white);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(item.title, margin, 22);

  // Page number
  doc.setTextColor(...BRAND.slate);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(`${index + 1} / ${total}`, pageW - margin, 22, { align: "right" });

  // Edit type badge
  const badgeColors: Record<string, [number, number, number]> = {
    Density: [139, 92, 246],
    Scale: [59, 130, 246],
    Recolor: [34, 197, 94],
    Remove: [239, 68, 68],
    Upload: [245, 183, 49],
    Mixed: [168, 85, 247],
  };
  const badgeColor = badgeColors[item.editType] || BRAND.gold;
  doc.setFillColor(...badgeColor);
  doc.roundedRect(margin, 42, 50, 14, 3, 3, "F");
  doc.setTextColor(...BRAND.white);
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.text(item.editType.toUpperCase(), margin + 25, 51, { align: "center" });

  // Changes description
  doc.setTextColor(...BRAND.slate);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  if (item.changes) {
    doc.text(item.changes, margin + 55, 51);
  }

  // Image area - side by side
  const imageAreaTop = 65;
  const imageAreaHeight = pageH - imageAreaTop - 45;
  const halfWidth = (pageW - margin * 3) / 2;

  // "Before" label
  doc.setTextColor(...BRAND.slate);
  doc.setFontSize(8);
  doc.text("BEFORE", margin + halfWidth / 2, imageAreaTop - 3, { align: "center" });

  // "After" label
  doc.text("AFTER", margin * 2 + halfWidth + halfWidth / 2, imageAreaTop - 3, { align: "center" });

  // Before image
  if (originalBase64) {
    const fit = fitImage(originalDims.width, originalDims.height, halfWidth, imageAreaHeight);
    const x = margin + (halfWidth - fit.w) / 2;
    const y = imageAreaTop + (imageAreaHeight - fit.h) / 2;
    try {
      doc.addImage(originalBase64, "JPEG", x, y, fit.w, fit.h);
    } catch {
      // Draw placeholder
      doc.setFillColor(...BRAND.darkSlate);
      doc.rect(margin, imageAreaTop, halfWidth, imageAreaHeight, "F");
      doc.setTextColor(...BRAND.slate);
      doc.setFontSize(10);
      doc.text("Image unavailable", margin + halfWidth / 2, imageAreaTop + imageAreaHeight / 2, { align: "center" });
    }
  } else {
    doc.setFillColor(...BRAND.darkSlate);
    doc.rect(margin, imageAreaTop, halfWidth, imageAreaHeight, "F");
    doc.setTextColor(...BRAND.slate);
    doc.setFontSize(10);
    doc.text("Image unavailable", margin + halfWidth / 2, imageAreaTop + imageAreaHeight / 2, { align: "center" });
  }

  // After image
  const afterX = margin * 2 + halfWidth;
  if (resultBase64) {
    const fit = fitImage(resultDims.width, resultDims.height, halfWidth, imageAreaHeight);
    const x = afterX + (halfWidth - fit.w) / 2;
    const y = imageAreaTop + (imageAreaHeight - fit.h) / 2;
    try {
      doc.addImage(resultBase64, "JPEG", x, y, fit.w, fit.h);
    } catch {
      doc.setFillColor(...BRAND.darkSlate);
      doc.rect(afterX, imageAreaTop, halfWidth, imageAreaHeight, "F");
      doc.setTextColor(...BRAND.slate);
      doc.setFontSize(10);
      doc.text("Image unavailable", afterX + halfWidth / 2, imageAreaTop + imageAreaHeight / 2, { align: "center" });
    }
  } else {
    doc.setFillColor(...BRAND.darkSlate);
    doc.rect(afterX, imageAreaTop, halfWidth, imageAreaHeight, "F");
    doc.setTextColor(...BRAND.slate);
    doc.setFontSize(10);
    doc.text("Image unavailable", afterX + halfWidth / 2, imageAreaTop + imageAreaHeight / 2, { align: "center" });
  }

  // Divider line between images
  doc.setDrawColor(...BRAND.gold);
  doc.setLineWidth(0.5);
  doc.line(margin + halfWidth + margin / 2, imageAreaTop, margin + halfWidth + margin / 2, imageAreaTop + imageAreaHeight);

  // Footer metadata
  const footerY = pageH - 25;
  doc.setFillColor(...BRAND.darkSlate);
  doc.rect(0, footerY - 5, pageW, 30, "F");

  doc.setTextColor(...BRAND.slate);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");

  const dateStr = new Date(item.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  doc.text(dateStr, margin, footerY + 5);

  if (item.creditsUsed) {
    doc.text(`${item.creditsUsed} credits`, margin + 80, footerY + 5);
  }

  doc.text(`By: ${item.userName}`, margin + 130, footerY + 5);

  // Aster Sports branding
  doc.setTextColor(100, 100, 100);
  doc.text("Aster Sports · Print Studio", pageW - margin, footerY + 5, { align: "right" });
}

/**
 * Main export function: generates the branded lookbook PDF
 */
export async function generateLookbookPdf(options: LookbookOptions): Promise<void> {
  const { items, onProgress } = options;
  const totalSteps = items.length * 2 + 2; // fetch original + fetch result per item, + logo + save
  let currentStep = 0;

  const report = (stage: string) => {
    currentStep++;
    onProgress?.(currentStep, totalSteps, stage);
  };

  // Create PDF (landscape A4)
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // Fetch logo
  report("Loading branding...");
  const logoBase64 = await fetchImageAsBase64(LOGO_URL);

  // Draw cover page
  drawCoverPage(doc, logoBase64, options);

  // Process each item
  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    // Fetch original image
    report(`Fetching original ${i + 1}/${items.length}...`);
    const originalBase64 = await fetchImageAsBase64(item.originalUrl);
    const originalDims = originalBase64
      ? await getImageDimensions(originalBase64)
      : { width: 1, height: 1 };

    // Fetch result image
    report(`Fetching result ${i + 1}/${items.length}...`);
    const resultBase64 = await fetchImageAsBase64(item.resultUrl);
    const resultDims = resultBase64
      ? await getImageDimensions(resultBase64)
      : { width: 1, height: 1 };

    // Add new page for comparison
    doc.addPage();
    drawComparisonPage(doc, item, i, items.length, originalBase64, resultBase64, originalDims, resultDims);
  }

  // Save
  report("Generating PDF...");
  const filename = `lookbook-${new Date().toISOString().slice(0, 10)}.pdf`;
  doc.save(filename);
}

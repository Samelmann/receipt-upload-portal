'use strict';

// ── State ────────────────────────────────────────────────────────────────────
const state = {
  pdfBlob:  null,   // final PDF blob ready to upload
  cropper:  null,   // Cropper.js instance
  loading:  false,
};

// ── DOM refs (populated in init) ─────────────────────────────────────────────
let el = {};

// ── Derive API URL from the current page path ─────────────────────────────────
// Page is served at  /{SECRET}/
// API is at          /{SECRET}/submit
function getSubmitUrl() {
  const parts = window.location.pathname.split('/').filter(Boolean);
  return '/' + parts[0] + '/submit';
}

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  el = {
    // Upload
    fileInput:        document.getElementById('fileInput'),
    uploadBtn:        document.getElementById('uploadBtn'),
    uploadPrompt:     document.getElementById('uploadPrompt'),
    filePreview:      document.getElementById('filePreview'),
    imagePreview:     document.getElementById('imagePreview'),
    previewImg:       document.getElementById('previewImg'),
    pdfPreview:       document.getElementById('pdfPreview'),
    pdfName:          document.getElementById('pdfName'),
    changeFileBtn:    document.getElementById('changeFileBtn'),
    uploadError:      document.getElementById('uploadError'),
    // Modals
    qualityModal:     document.getElementById('qualityModal'),
    warnContinue:     document.getElementById('warnContinue'),
    warnCancel:       document.getElementById('warnCancel'),
    cropModal:        document.getElementById('cropModal'),
    cropImage:        document.getElementById('cropImage'),
    cropConfirm:      document.getElementById('cropConfirm'),
    cropCancel:       document.getElementById('cropCancel'),
    // Form fields
    form:             document.getElementById('expenseForm'),
    nickname:         document.getElementById('nickname'),
    date:             document.getElementById('date'),
    category:         document.getElementById('category'),
    carUsed:          document.getElementById('carUsed'),
    hotelName:        document.getElementById('hotelName'),
    rentalCompany:    document.getElementById('rentalCompany'),
    opponent:         document.getElementById('opponent'),
    opponentOther:    document.getElementById('opponentOther'),
    matchup:          document.getElementById('matchup'),
    amount:           document.getElementById('amount'),
    needsReimb:       document.getElementById('needsReimbursement'),
    ibanToggle:       document.getElementById('ibanToggle'),
    ibanSection:      document.getElementById('ibanSection'),
    fullName:         document.getElementById('fullName'),
    iban:             document.getElementById('iban'),
    // Submit
    submitBtn:        document.getElementById('submitBtn'),
    submitLabel:      document.getElementById('submitLabel'),
    submitSpinner:    document.getElementById('submitSpinner'),
    // Screens
    successScreen:    document.getElementById('successScreen'),
    successMsg:       document.getElementById('successMsg'),
    missingIbanMsg:   document.getElementById('missingIbanMsg'),
    submitAnotherBtn: document.getElementById('submitAnotherBtn'),
  };

  bindEvents();

  // Default date to today
  el.date.value = new Date().toISOString().slice(0, 10);
});

// ── Event binding ─────────────────────────────────────────────────────────────
function bindEvents() {
  // Upload button → show quality warning
  el.uploadBtn.addEventListener('click', () => openModal(el.qualityModal));
  el.changeFileBtn.addEventListener('click', () => openModal(el.qualityModal));

  // Quality warning actions
  el.warnContinue.addEventListener('click', () => {
    closeModal(el.qualityModal);
    el.fileInput.click();
  });
  el.warnCancel.addEventListener('click', () => closeModal(el.qualityModal));

  // File selected
  el.fileInput.addEventListener('change', onFileSelected);

  // Crop actions
  el.cropConfirm.addEventListener('click', onCropConfirm);
  el.cropCancel.addEventListener('click', () => {
    closeModal(el.cropModal);
    resetCropper();
    el.fileInput.value = '';
  });

  // Conditional fields
  el.category.addEventListener('change', onCategoryChange);
  el.opponent.addEventListener('change', onOpponentChange);

  // IBAN collapsible
  el.ibanToggle.addEventListener('click', toggleIban);

  // Form submit
  el.form.addEventListener('submit', onSubmit);

  // Submit another
  el.submitAnotherBtn.addEventListener('click', resetAll);
}

// ── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(modal) {
  modal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}
function closeModal(modal) {
  modal.classList.add('hidden');
  document.body.style.overflow = '';
}

// ── File selection ────────────────────────────────────────────────────────────
async function onFileSelected(e) {
  const file = e.target.files[0];
  el.fileInput.value = ''; // reset so same file can be re-selected
  if (!file) return;

  if (file.type === 'application/pdf') {
    // PDF: accept as-is, no crop needed
    state.pdfBlob = file;
    showPDFPreview(file.name);
    return;
  }

  // Image: possibly convert HEIC, then open crop modal
  let imageFile = file;
  if (isHEIC(file)) {
    try {
      imageFile = await convertHEIC(file);
    } catch {
      alert('Could not process this image format. Please try a JPEG or PNG.');
      return;
    }
  }

  openCropModal(imageFile);
}

function isHEIC(file) {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    /\.heic$/i.test(file.name) ||
    /\.heif$/i.test(file.name)
  );
}

async function convertHEIC(file) {
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(blob) ? blob[0] : blob;
}

// ── Crop modal ────────────────────────────────────────────────────────────────
function openCropModal(imageBlob) {
  const url = URL.createObjectURL(imageBlob);
  el.cropImage.src = url;
  el.cropImage.onload = () => {
    if (state.cropper) state.cropper.destroy();
    state.cropper = new Cropper(el.cropImage, {
      viewMode: 1,
      dragMode: 'move',
      autoCropArea: 0.95,
      restore: false,
      guides: true,
      center: true,
      highlight: false,
      cropBoxMovable: true,
      cropBoxResizable: true,
      toggleDragModeOnDblclick: false,
    });
  };
  openModal(el.cropModal);
}

function resetCropper() {
  if (state.cropper) {
    state.cropper.destroy();
    state.cropper = null;
  }
  el.cropImage.src = '';
}

function onCropConfirm() {
  if (!state.cropper) return;

  const canvas = state.cropper.getCroppedCanvas({
    maxWidth:              2480,
    maxHeight:             3508,
    imageSmoothingEnabled: true,
    imageSmoothingQuality: 'high',
  });

  // Convert cropped canvas → JPEG → PDF
  canvas.toBlob(async (jpegBlob) => {
    try {
      state.pdfBlob = await imageToPDF(jpegBlob);
      showImagePreview(canvas.toDataURL('image/jpeg', 0.7));
      closeModal(el.cropModal);
      resetCropper();
    } catch (err) {
      console.error('PDF conversion failed:', err);
      alert('Could not convert the image to PDF. Please try again.');
    }
  }, 'image/jpeg', 0.88);
}

// ── Image → PDF conversion (client-side via pdf-lib) ──────────────────────────
async function imageToPDF(jpegBlob) {
  const { PDFDocument } = PDFLib;
  const pdfDoc = await PDFDocument.create();

  const imgBytes = await jpegBlob.arrayBuffer();
  const jpgImage = await pdfDoc.embedJpg(imgBytes);

  // A4 page in points (595.28 × 841.89)
  const pageW = 595.28;
  const pageH = 841.89;
  const margin = 20;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;

  const scale = Math.min(maxW / jpgImage.width, maxH / jpgImage.height);
  const imgW = jpgImage.width  * scale;
  const imgH = jpgImage.height * scale;

  const page = pdfDoc.addPage([pageW, pageH]);
  page.drawImage(jpgImage, {
    x: (pageW - imgW) / 2,
    y: (pageH - imgH) / 2,
    width:  imgW,
    height: imgH,
  });

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: 'application/pdf' });
}

// ── Preview helpers ───────────────────────────────────────────────────────────
function showImagePreview(dataUrl) {
  el.previewImg.src = dataUrl;
  el.imagePreview.classList.remove('hidden');
  el.pdfPreview.classList.add('hidden');
  el.uploadPrompt.classList.add('hidden');
  el.filePreview.classList.remove('hidden');
  hideUploadError();
}

function showPDFPreview(filename) {
  el.pdfName.textContent = filename;
  el.pdfPreview.classList.remove('hidden');
  el.imagePreview.classList.add('hidden');
  el.uploadPrompt.classList.add('hidden');
  el.filePreview.classList.remove('hidden');
  hideUploadError();
}

function hideUploadError() {
  el.uploadError.classList.add('hidden');
}

// ── Conditional fields ────────────────────────────────────────────────────────
function onCategoryChange() {
  const val = el.category.value;

  toggle('field-carUsed',        val === 'Gas');
  toggle('field-hotelName',      val === 'Accommodation');
  toggle('field-rentalCompany',  val === 'Car Rental');

  if (val !== 'Gas')           el.carUsed.value = '';
  if (val !== 'Accommodation') el.hotelName.value = '';
  if (val !== 'Car Rental')    el.rentalCompany.value = '';
}

function onOpponentChange() {
  const isOther = el.opponent.value === 'other';
  toggle('field-opponentOther', isOther);
  if (!isOther) el.opponentOther.value = '';
}

function toggle(fieldId, show) {
  document.getElementById(fieldId).classList.toggle('hidden', !show);
}

// ── IBAN collapsible ──────────────────────────────────────────────────────────
function toggleIban() {
  const expanded = el.ibanToggle.getAttribute('aria-expanded') === 'true';
  el.ibanToggle.setAttribute('aria-expanded', String(!expanded));
  el.ibanSection.classList.toggle('hidden', expanded);
}

// ── Validation ────────────────────────────────────────────────────────────────
function validate() {
  let ok = true;

  // File
  if (!state.pdfBlob) {
    el.uploadError.classList.remove('hidden');
    ok = false;
  }

  ok = requireField(el.nickname,  'Please enter your nickname.')          && ok;
  ok = requireField(el.date,      'Please select the receipt date.')      && ok;
  ok = requireField(el.category,  'Please select a category.')            && ok;
  ok = requireField(el.opponent,  'Please select an opponent.')           && ok;
  ok = requireField(el.matchup,   'Please select a matchup.')             && ok;
  ok = requireAmount()                                                     && ok;

  if (el.category.value === 'Gas') {
    ok = requireField(el.carUsed,       'Please enter which car was used.')     && ok;
  }
  if (el.category.value === 'Accommodation') {
    ok = requireField(el.hotelName,     'Please enter the hotel name.')       && ok;
  }
  if (el.category.value === 'Car Rental') {
    ok = requireField(el.rentalCompany, 'Please enter the rental company.')   && ok;
  }
  if (el.opponent.value === 'other') {
    ok = requireField(el.opponentOther, 'Please enter the opponent name.')    && ok;
  }

  return ok;
}

function requireField(input, msg) {
  const field = input.closest('.field');
  const errEl = field?.querySelector('.field-error');
  if (!input.value.trim()) {
    input.classList.add('invalid');
    if (errEl) { errEl.textContent = msg; errEl.classList.remove('hidden'); }
    return false;
  }
  input.classList.remove('invalid');
  if (errEl) errEl.classList.add('hidden');
  return true;
}

function requireAmount() {
  const field = el.amount.closest('.field');
  const errEl = field?.querySelector('.field-error');
  const val = parseFloat(el.amount.value);
  if (!el.amount.value || isNaN(val) || val <= 0) {
    el.amount.classList.add('invalid');
    if (errEl) { errEl.textContent = 'Please enter a valid amount greater than 0.'; errEl.classList.remove('hidden'); }
    return false;
  }
  el.amount.classList.remove('invalid');
  if (errEl) errEl.classList.add('hidden');
  return true;
}

// Clear all validation marks
function clearValidation() {
  document.querySelectorAll('.invalid').forEach(el => el.classList.remove('invalid'));
  document.querySelectorAll('.field-error').forEach(el => el.classList.add('hidden'));
  el.uploadError.classList.add('hidden');
}

// ── Form submission ───────────────────────────────────────────────────────────
async function onSubmit(e) {
  e.preventDefault();
  if (state.loading) return;

  clearValidation();
  if (!validate()) {
    // Scroll first error into view
    const firstErr = document.querySelector('.field-error:not(.hidden), .invalid');
    firstErr?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  // Resolve opponent value
  const opponentVal = el.opponent.value === 'other'
    ? el.opponentOther.value.trim()
    : el.opponent.value;

  const formData = new FormData();
  formData.append('receipt',              state.pdfBlob, 'receipt.pdf');
  formData.append('nickname',             el.nickname.value.trim());
  formData.append('date',                 el.date.value);
  formData.append('category',             el.category.value);
  formData.append('carUsed',              el.carUsed.value.trim());
  formData.append('hotelName',            el.hotelName.value.trim());
  formData.append('rentalCompany',        el.rentalCompany.value.trim());
  formData.append('opponent',             opponentVal);
  formData.append('matchup',              el.matchup.value);
  formData.append('amount',               el.amount.value);
  formData.append('needsReimbursement',   el.needsReimb.checked ? 'true' : 'false');
  formData.append('fullName',             el.fullName.value.trim());
  formData.append('iban',                 el.iban.value.trim());

  setLoading(true);

  try {
    const res = await fetch(getSubmitUrl(), { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Submission failed');

    showSuccess(data);
  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    setLoading(false);
  }
}

function setLoading(on) {
  state.loading = on;
  el.submitBtn.disabled = on;
  el.submitLabel.classList.toggle('hidden', on);
  el.submitSpinner.classList.toggle('hidden', !on);
}

// ── Success screen ────────────────────────────────────────────────────────────
function showSuccess(data) {
  if (data.missingIban) {
    el.missingIbanMsg.classList.remove('hidden');
  }

  if (!data.wantsReimbursement) {
    el.successMsg.textContent = 'Your expense has been recorded. No reimbursement requested.';
  } else if (data.qrGenerated) {
    el.successMsg.textContent = 'Your expense has been recorded and a payment QR code has been generated for Sammy.';
  } else {
    el.successMsg.textContent = 'Your expense has been recorded.';
  }

  if (data.googleError || data.sheetOk === false) {
    el.successMsg.textContent +=
      '\n\n⚠ The expense sheet could not be updated automatically (' +
      (data.googleError || 'unknown error') +
      '). The receipt was saved, please tell Sammy so he can enter it manually.';
  }

  el.successScreen.classList.remove('hidden');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Reset everything for "Submit another" ─────────────────────────────────────
function resetAll() {
  el.successScreen.classList.add('hidden');
  el.missingIbanMsg.classList.add('hidden');

  // Reset state
  state.pdfBlob = null;

  // Reset upload UI
  el.uploadPrompt.classList.remove('hidden');
  el.filePreview.classList.add('hidden');
  el.imagePreview.classList.add('hidden');
  el.pdfPreview.classList.add('hidden');
  el.previewImg.src = '';

  // Reset form
  el.form.reset();
  el.date.value = new Date().toISOString().slice(0, 10);

  // Reset conditional fields
  toggle('field-carUsed',       false);
  toggle('field-hotelName',     false);
  toggle('field-rentalCompany', false);
  toggle('field-opponentOther', false);

  // Reset IBAN collapsible
  el.ibanToggle.setAttribute('aria-expanded', 'false');
  el.ibanSection.classList.add('hidden');

  clearValidation();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Aura Health Clinic · Client Application
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const tabSlotsBtn = document.getElementById('tabSlotsBtn');
  const tabBookingsBtn = document.getElementById('tabBookingsBtn');
  const slotsSection = document.getElementById('slotsSection');
  const bookingsSection = document.getElementById('bookingsSection');

  // Metrics
  const metricAvailable = document.getElementById('metricAvailable');
  const metricProviders = document.getElementById('metricProviders');
  const metricTotal = document.getElementById('metricTotal');

  // Confirmation Banner
  const confirmationBanner = document.getElementById('confirmationBanner');
  const confBookingId = document.getElementById('confBookingId');
  const confName = document.getElementById('confName');
  const confEmail = document.getElementById('confEmail');
  const confSlotId = document.getElementById('confSlotId');
  const closeConfBtn = document.getElementById('closeConfBtn');
  const copyIdBtn = document.getElementById('copyIdBtn');
  const cancelBookingFromConfBtn = document.getElementById('cancelBookingFromConfBtn');

  // Slots & Filter
  const providerChipsContainer = document.getElementById('providerChipsContainer');
  const refreshSlotsBtn = document.getElementById('refreshSlotsBtn');
  const slotsGrid = document.getElementById('slotsGrid');

  // Booking Modal
  const bookingModal = document.getElementById('bookingModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const bookingForm = document.getElementById('bookingForm');
  const modalSlotSummary = document.getElementById('modalSlotSummary');
  const modalSlotId = document.getElementById('modalSlotId');
  const patientNameInput = document.getElementById('patientName');
  const patientEmailInput = document.getElementById('patientEmail');
  const submitBookingBtn = document.getElementById('submitBookingBtn');

  // API Key Modal
  const keyModal = document.getElementById('keyModal');
  const openKeyModalBtn = document.getElementById('openKeyModalBtn');
  const closeKeyModalBtn = document.getElementById('closeKeyModalBtn');
  const closeKeyModalBackdrop = document.getElementById('closeKeyModalBackdrop');
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
  const saveKeyBtn = document.getElementById('saveKeyBtn');

  // Lookups & Pagination
  const lookupForm = document.getElementById('lookupForm');
  const lookupEmailInput = document.getElementById('lookupEmail');
  const userBookingsList = document.getElementById('userBookingsList');
  const paginationControls = document.getElementById('paginationControls');
  const loadMoreBtn = document.getElementById('loadMoreBtn');
  const toastContainer = document.getElementById('toastContainer');

  // State
  let slotsData = [];
  let selectedProvider = '';
  let currentLookupEmail = '';
  let nextCursor = null;
  let activeConfirmationBookingId = null;
  let pendingBooking = null;

  // Restore API key
  const savedKey = localStorage.getItem('clinic_api_key');
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }

  function getApiKey() {
    return apiKeyInput.value.trim() || 'koya-secret-key-123';
  }

  // Toast notifications
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '⚠️';

    toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
    toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 4500);
  }

  // API Key Modal interactions
  openKeyModalBtn.addEventListener('click', () => {
    keyModal.classList.remove('hidden');
  });

  function closeKeyModal() {
    keyModal.classList.add('hidden');
  }

  closeKeyModalBtn.addEventListener('click', closeKeyModal);
  closeKeyModalBackdrop.addEventListener('click', closeKeyModal);

  toggleKeyVisibility.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  saveKeyBtn.addEventListener('click', () => {
    localStorage.setItem('clinic_api_key', apiKeyInput.value.trim());
    closeKeyModal();
    showToast('API Key saved successfully.', 'success');
    loadSlots();
  });

  // Tab switching
  tabSlotsBtn.addEventListener('click', () => {
    tabSlotsBtn.classList.add('active');
    tabBookingsBtn.classList.remove('active');
    slotsSection.classList.remove('hidden');
    bookingsSection.classList.add('hidden');
  });

  tabBookingsBtn.addEventListener('click', () => {
    tabBookingsBtn.classList.add('active');
    tabSlotsBtn.classList.remove('active');
    bookingsSection.classList.remove('hidden');
    slotsSection.classList.add('hidden');
  });

  // Helper date & time formatting
  function formatDateTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
    } catch {
      return isoString;
    }
  }

  function formatTimeOnly(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  }

  function getInitials(name) {
    return name
      .replace(/^Dr\.?\s+/i, '')
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  // Load Slots from API
  async function loadSlots() {
    slotsGrid.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Loading clinic schedule...</p>
      </div>
    `;

    const url = '/slots';

    try {
      const res = await fetch(url, {
        headers: {
          'X-API-Key': getApiKey(),
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load schedule');
      }

      slotsData = data.slots || [];
      renderMetrics(slotsData);
      renderProviderChips(slotsData);
      renderSlots(selectedProvider ? slotsData.filter(slot => slot.provider === selectedProvider) : slotsData);
    } catch (err) {
      slotsGrid.innerHTML = `
        <div class="empty-placeholder">
          <div class="empty-icon">⚠️</div>
          <h3>Unable to Load Appointments</h3>
          <p>${escapeHtml(err.message)}. Check your API key under settings.</p>
        </div>
      `;
      showToast(err.message, 'error');
    }
  }

  function renderMetrics(slots) {
    const total = slots.length;
    const now = Date.now();
    const available = slots.filter((s) => s.available && new Date(s.start).getTime() > now).length;
    const providers = new Set(slots.map((s) => s.provider)).size;

    metricAvailable.textContent = available;
    metricProviders.textContent = providers;
    metricTotal.textContent = total;
  }

  function renderProviderChips(slots) {
    const providers = Array.from(new Set(slots.map((s) => s.provider))).sort();

    let html = `
      <button class="chip ${selectedProvider === '' ? 'active' : ''}" data-provider="">
        All Doctors
      </button>
    `;

    providers.forEach((prov) => {
      const count = slots.filter((s) => s.provider === prov && s.available).length;
      html += `
        <button class="chip ${selectedProvider === prov ? 'active' : ''}" data-provider="${escapeHtml(prov)}">
          ${escapeHtml(prov)} (${count})
        </button>
      `;
    });

    providerChipsContainer.innerHTML = html;

    providerChipsContainer.querySelectorAll('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        selectedProvider = chip.getAttribute('data-provider');
        loadSlots();
      });
    });
  }

  function renderSlots(slots) {
    if (slots.length === 0) {
      slotsGrid.innerHTML = `
        <div class="empty-placeholder">
          <div class="empty-icon">🗓️</div>
          <h3>No Appointments Scheduled</h3>
          <p>No available slots found for the selected criteria.</p>
        </div>
      `;
      return;
    }

    slotsGrid.innerHTML = slots
      .map((slot) => {
        const isPast = new Date(slot.start).getTime() <= Date.now();
        const isAvailable = slot.available && !isPast;

        let badgeHtml = '';
        if (!slot.available) {
          badgeHtml = '<span class="slot-badge badge-booked">Booked</span>';
        } else if (isPast) {
          badgeHtml = '<span class="slot-badge badge-expired">Expired</span>';
        } else {
          badgeHtml = '<span class="slot-badge badge-available">Available</span>';
        }

        const dateStr = formatDateTime(slot.start);
        const timeRange = `${formatTimeOnly(slot.start)} – ${formatTimeOnly(slot.end)}`;
        const initials = getInitials(slot.provider);

        return `
        <div class="slot-card ${!isAvailable ? 'booked-card' : ''}" data-slot-id="${escapeHtml(slot.id)}">
          <div class="slot-card-top">
            <div class="doctor-identity">
              <div class="doctor-avatar">${escapeHtml(initials)}</div>
              <div>
                <div class="doctor-name">${escapeHtml(slot.provider)}</div>
                <div class="doctor-role">General Physician · Consultation</div>
              </div>
            </div>
            ${badgeHtml}
          </div>

          <div class="slot-time-box">
            <div class="time-row">
              <span class="time-icon">📅</span>
              <strong>${dateStr}</strong>
            </div>
            <div class="time-row">
              <span class="time-icon">⏰</span>
              <span>${timeRange}</span>
              <span class="slot-id-tag">#${escapeHtml(slot.id)}</span>
            </div>
          </div>

          ${
            isAvailable
              ? `
            <button class="btn-book-slot" data-slot-id="${escapeHtml(slot.id)}">
              <span>Book Appointment</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
          `
              : `
            <button class="btn-disabled-slot" disabled>
              ${slot.available ? 'Past Time Slot' : 'Slot Unavailable'}
            </button>
          `
          }
        </div>
      `;
      })
      .join('');

    // Attach listeners
    slotsGrid.querySelectorAll('.btn-book-slot').forEach((btn) => {
      btn.addEventListener('click', () => {
        const slotId = btn.getAttribute('data-slot-id');
        openBookingModal(slotId);
      });
    });
  }

  function openBookingModal(slotId) {
    const slot = slotsData.find((s) => s.id === slotId);
    if (!slot) return;

    modalSlotId.value = slot.id;
    modalSlotSummary.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div>
          <strong style="color:var(--slate-900); font-size:1rem;">${escapeHtml(slot.provider)}</strong>
          <div style="color:var(--slate-600); font-size:0.85rem; margin-top:2px;">
            ${formatDateTime(slot.start)} · ${formatTimeOnly(slot.start)} – ${formatTimeOnly(slot.end)}
          </div>
        </div>
        <span style="font-family:monospace; font-size:0.8rem; background:#fff; padding:3px 8px; border-radius:6px; border:1px solid var(--primary-200); color:var(--primary-700);">
          ${escapeHtml(slot.id)}
        </span>
      </div>
    `;

    bookingModal.classList.remove('hidden');
    patientNameInput.focus();
  }

  function closeBookingModal() {
    bookingModal.classList.add('hidden');
    bookingForm.reset();
    pendingBooking = null;
  }

  closeModalBtn.addEventListener('click', closeBookingModal);
  cancelModalBtn.addEventListener('click', closeBookingModal);

  // Form submission
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slot_id = modalSlotId.value;
    const name = patientNameInput.value.trim();
    const email = patientEmailInput.value.trim();
    const payload = JSON.stringify({ slot_id, name, email });
    if (pendingBooking?.payload !== payload) {
      pendingBooking = { payload, key: crypto.randomUUID() };
    }

    submitBookingBtn.disabled = true;
    submitBookingBtn.innerHTML = `
      <div class="spinner" style="width:16px; height:16px; border-width:2px; margin:0;"></div>
      <span>Booking...</span>
    `;

    try {
      const res = await fetch('/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': getApiKey(),
          'Idempotency-Key': pendingBooking.key,
        },
        body: payload,
      });

      const data = await res.json();
      if (!res.ok) {
        // A definite API rejection can be a fresh attempt after correction or
        // Retry-After. A lost response retains the key to recover its outcome.
        pendingBooking = null;
        throw new Error(data.error || 'Failed to book appointment');
      }

      closeBookingModal();
      showConfirmation(data);
      showToast('Appointment booked successfully!', 'success');
      loadSlots();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      submitBookingBtn.disabled = false;
      submitBookingBtn.innerHTML = `
        <span>Confirm Booking</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      `;
    }
  });

  function showConfirmation(booking) {
    activeConfirmationBookingId = booking.id;
    confBookingId.textContent = booking.id;
    confName.textContent = booking.name;
    confEmail.textContent = booking.email;
    confSlotId.textContent = booking.slot_id;

    confirmationBanner.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeConfBtn.addEventListener('click', () => {
    confirmationBanner.classList.add('hidden');
  });

  copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(confBookingId.textContent).then(() => {
      copyIdBtn.innerHTML = `<span>Copied!</span>`;
      setTimeout(() => {
        copyIdBtn.innerHTML = `
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
          <span>Copy</span>
        `;
      }, 2000);
    });
  });

  cancelBookingFromConfBtn.addEventListener('click', async () => {
    if (!activeConfirmationBookingId) return;
    if (!confirm('Are you sure you want to cancel this appointment?')) return;

    try {
      const res = await fetch(`/bookings/${activeConfirmationBookingId}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': getApiKey(),
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to cancel');

      showToast('Appointment successfully cancelled.', 'info');
      confirmationBanner.classList.add('hidden');
      loadSlots();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Patient Lookup tab
  lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    currentLookupEmail = lookupEmailInput.value.trim();
    nextCursor = null;
    userBookingsList.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <p>Searching appointments for ${escapeHtml(currentLookupEmail)}...</p>
      </div>
    `;
    fetchUserBookings(false);
  });

  loadMoreBtn.addEventListener('click', () => {
    if (nextCursor) {
      fetchUserBookings(true);
    }
  });

  async function fetchUserBookings(append = false) {
    if (!currentLookupEmail) return;

    let url = `/bookings?email=${encodeURIComponent(currentLookupEmail)}&limit=5`;
    if (nextCursor) {
      url += `&cursor=${encodeURIComponent(nextCursor)}`;
    }

    try {
      const res = await fetch(url, {
        headers: {
          'X-API-Key': getApiKey(),
        },
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to retrieve bookings');

      nextCursor = data.next_cursor;
      renderUserBookings(data.bookings || [], append);

      if (nextCursor) {
        paginationControls.classList.remove('hidden');
      } else {
        paginationControls.classList.add('hidden');
      }
    } catch (err) {
      userBookingsList.innerHTML = `
        <div class="empty-placeholder">
          <div class="empty-icon">⚠️</div>
          <h3>Search Error</h3>
          <p>${escapeHtml(err.message)}</p>
        </div>
      `;
      showToast(err.message, 'error');
    }
  }

  function renderUserBookings(bookings, append) {
    if (!append && bookings.length === 0) {
      userBookingsList.innerHTML = `
        <div class="empty-placeholder">
          <div class="empty-icon">🔍</div>
          <h3>No Appointments Found</h3>
          <p>We could not find any appointments registered to ${escapeHtml(currentLookupEmail)}.</p>
        </div>
      `;
      return;
    }

    const itemsHtml = bookings
      .map((b) => {
        const isConfirmed = b.status === 'confirmed';
        return `
        <div class="booking-item-card" id="booking-item-${b.id}">
          <div>
            <span class="booking-meta-id">Ref #${escapeHtml(b.id)}</span>
            <div class="booking-patient-info">${escapeHtml(b.name)}</div>
            <div class="booking-time-info">
              Slot: <code>${escapeHtml(b.slot_id)}</code> · Created: ${formatDateTime(b.created_at)}
            </div>
          </div>
          <div class="booking-actions">
            <span class="${isConfirmed ? 'status-badge-confirmed' : 'status-badge-cancelled'}">
              ${b.status}
            </span>
            ${
              isConfirmed
                ? `<button class="btn-danger-outline cancel-item-btn" data-id="${b.id}">Cancel</button>`
                : ''
            }
          </div>
        </div>
      `;
      })
      .join('');

    if (append) {
      userBookingsList.insertAdjacentHTML('beforeend', itemsHtml);
    } else {
      userBookingsList.innerHTML = itemsHtml;
    }

    userBookingsList.querySelectorAll('.cancel-item-btn').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = 'true';
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!confirm('Are you sure you want to cancel this appointment?')) return;

        try {
          const res = await fetch(`/bookings/${id}`, {
            method: 'DELETE',
            headers: {
              'X-API-Key': getApiKey(),
            },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to cancel');

          showToast(`Appointment #${id} cancelled.`, 'info');
          nextCursor = null;
          fetchUserBookings(false);
          loadSlots();
        } catch (err) {
          showToast(err.message, 'error');
        }
      });
    });
  }

  refreshSlotsBtn.addEventListener('click', loadSlots);

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Initial fetch
  loadSlots();
});

// Clinic Booking Frontend Client
document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const apiKeyInput = document.getElementById('apiKeyInput');
  const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
  const tabSlotsBtn = document.getElementById('tabSlotsBtn');
  const tabBookingsBtn = document.getElementById('tabBookingsBtn');
  const slotsSection = document.getElementById('slotsSection');
  const bookingsSection = document.getElementById('bookingsSection');
  const alertBanner = document.getElementById('alertBanner');
  const confirmationBanner = document.getElementById('confirmationBanner');
  const confBookingId = document.getElementById('confBookingId');
  const confName = document.getElementById('confName');
  const confEmail = document.getElementById('confEmail');
  const confSlotId = document.getElementById('confSlotId');
  const confCreated = document.getElementById('confCreated');
  const closeConfBtn = document.getElementById('closeConfBtn');
  const copyIdBtn = document.getElementById('copyIdBtn');
  const cancelBookingFromConfBtn = document.getElementById('cancelBookingFromConfBtn');

  const providerFilter = document.getElementById('providerFilter');
  const refreshSlotsBtn = document.getElementById('refreshSlotsBtn');
  const slotsGrid = document.getElementById('slotsGrid');

  const bookingModal = document.getElementById('bookingModal');
  const closeModalBtn = document.getElementById('closeModalBtn');
  const cancelModalBtn = document.getElementById('cancelModalBtn');
  const bookingForm = document.getElementById('bookingForm');
  const modalSlotSummary = document.getElementById('modalSlotSummary');
  const modalSlotId = document.getElementById('modalSlotId');
  const patientNameInput = document.getElementById('patientName');
  const patientEmailInput = document.getElementById('patientEmail');

  const lookupForm = document.getElementById('lookupForm');
  const lookupEmailInput = document.getElementById('lookupEmail');
  const userBookingsList = document.getElementById('userBookingsList');
  const paginationControls = document.getElementById('paginationControls');
  const loadMoreBtn = document.getElementById('loadMoreBtn');

  // State
  let slotsData = [];
  let currentLookupEmail = '';
  let nextCursor = null;
  let activeConfirmationBookingId = null;

  // Restore API key from storage
  const savedKey = localStorage.getItem('clinic_api_key');
  if (savedKey) {
    apiKeyInput.value = savedKey;
  }

  apiKeyInput.addEventListener('input', () => {
    localStorage.setItem('clinic_api_key', apiKeyInput.value.trim());
  });

  toggleKeyVisibility.addEventListener('click', () => {
    apiKeyInput.type = apiKeyInput.type === 'password' ? 'text' : 'password';
  });

  function getApiKey() {
    return apiKeyInput.value.trim();
  }

  // Alerts
  function showAlert(message, type = 'error') {
    alertBanner.textContent = message;
    alertBanner.className = `alert ${type}`;
    alertBanner.classList.remove('hidden');
    setTimeout(() => {
      alertBanner.classList.add('hidden');
    }, 6000);
  }

  function hideAlert() {
    alertBanner.classList.add('hidden');
  }

  // Tabs
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

  // Date/Time formatting helper
  function formatDateTime(isoString) {
    try {
      const d = new Date(isoString);
      return d.toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
    } catch {
      return isoString;
    }
  }

  // Fetch Slots
  async function loadSlots() {
    slotsGrid.innerHTML = '<div class="loading">Loading appointment slots...</div>';
    hideAlert();

    const provider = providerFilter.value;
    const url = provider ? `/slots?provider=${encodeURIComponent(provider)}` : '/slots';

    try {
      const res = await fetch(url, {
        headers: {
          'X-API-Key': getApiKey(),
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to load slots');
      }

      slotsData = data.slots || [];
      updateProviderOptions(slotsData);
      renderSlots(slotsData);
    } catch (err) {
      slotsGrid.innerHTML = `<div class="empty-state">Error: ${err.message}. Please check your API Key.</div>`;
      showAlert(err.message, 'error');
    }
  }

  function updateProviderOptions(slots) {
    const currentVal = providerFilter.value;
    const providers = Array.from(new Set(slots.map((s) => s.provider))).sort();

    // Preserve 'All Providers'
    providerFilter.innerHTML = '<option value="">All Providers</option>';
    providers.forEach((prov) => {
      const opt = document.createElement('option');
      opt.value = prov;
      opt.textContent = prov;
      if (prov === currentVal) opt.selected = true;
      providerFilter.appendChild(opt);
    });
  }

  function renderSlots(slots) {
    if (slots.length === 0) {
      slotsGrid.innerHTML = '<div class="empty-state">No slots available.</div>';
      return;
    }

    slotsGrid.innerHTML = slots
      .map((slot) => {
        const isPast = new Date(slot.start).getTime() <= Date.now();
        const canBook = slot.available && !isPast;

        let badgeHtml = '';
        if (!slot.available) {
          badgeHtml = '<span class="badge booked">Booked</span>';
        } else if (isPast) {
          badgeHtml = '<span class="badge booked">Expired</span>';
        } else {
          badgeHtml = '<span class="badge available">Available</span>';
        }

        return `
        <div class="slot-card" data-slot-id="${slot.id}">
          <div class="slot-card-header">
            <div class="slot-provider">${escapeHtml(slot.provider)}</div>
            ${badgeHtml}
          </div>
          <div class="slot-time">
            <div><strong>Start:</strong> ${formatDateTime(slot.start)}</div>
            <div><strong>End:</strong> ${formatDateTime(slot.end)}</div>
          </div>
          <button 
            class="btn ${canBook ? 'btn-primary' : 'btn-secondary'} book-slot-btn" 
            data-slot-id="${slot.id}"
            ${!canBook ? 'disabled' : ''}
          >
            ${slot.available ? (isPast ? 'Past Slot' : 'Book Appointment') : 'Already Booked'}
          </button>
        </div>
      `;
      })
      .join('');

    // Attach click listeners to book buttons
    slotsGrid.querySelectorAll('.book-slot-btn:not(:disabled)').forEach((btn) => {
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
      <p><strong>Provider:</strong> ${escapeHtml(slot.provider)}</p>
      <p><strong>Appointment:</strong> ${formatDateTime(slot.start)} – ${formatDateTime(slot.end)}</p>
      <p><strong>Slot ID:</strong> <code>${slot.id}</code></p>
    `;

    bookingModal.classList.remove('hidden');
    patientNameInput.focus();
  }

  function closeBookingModal() {
    bookingModal.classList.add('hidden');
    bookingForm.reset();
  }

  closeModalBtn.addEventListener('click', closeBookingModal);
  cancelModalBtn.addEventListener('click', closeBookingModal);

  // Submit Booking
  bookingForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const slot_id = modalSlotId.value;
    const name = patientNameInput.value.trim();
    const email = patientEmailInput.value.trim();

    const submitBtn = document.getElementById('submitBookingBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Booking...';

    try {
      const res = await fetch('/bookings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': getApiKey(),
        },
        body: JSON.stringify({ slot_id, name, email }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to book slot');
      }

      closeBookingModal();
      showConfirmation(data);
      loadSlots(); // Refresh slot availability
    } catch (err) {
      showAlert(err.message, 'error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Confirm Booking';
    }
  });

  function showConfirmation(booking) {
    activeConfirmationBookingId = booking.id;
    confBookingId.textContent = booking.id;
    confName.textContent = booking.name;
    confEmail.textContent = booking.email;
    confSlotId.textContent = booking.slot_id;
    confCreated.textContent = formatDateTime(booking.created_at);

    confirmationBanner.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  closeConfBtn.addEventListener('click', () => {
    confirmationBanner.classList.add('hidden');
  });

  copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(confBookingId.textContent).then(() => {
      copyIdBtn.textContent = 'Copied!';
      setTimeout(() => (copyIdBtn.textContent = 'Copy'), 2000);
    });
  });

  cancelBookingFromConfBtn.addEventListener('click', async () => {
    if (!activeConfirmationBookingId) return;
    if (!confirm('Are you sure you want to cancel this booking?')) return;

    try {
      const res = await fetch(`/bookings/${activeConfirmationBookingId}`, {
        method: 'DELETE',
        headers: {
          'X-API-Key': getApiKey(),
        },
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to cancel booking');
      }

      showAlert('Booking successfully cancelled.', 'info');
      confirmationBanner.classList.add('hidden');
      loadSlots();
    } catch (err) {
      showAlert(err.message, 'error');
    }
  });

  // My Bookings lookup
  lookupForm.addEventListener('submit', (e) => {
    e.preventDefault();
    currentLookupEmail = lookupEmailInput.value.trim();
    nextCursor = null;
    userBookingsList.innerHTML = '<div class="loading">Searching bookings...</div>';
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
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch bookings');
      }

      nextCursor = data.next_cursor;
      renderUserBookings(data.bookings || [], append);

      if (nextCursor) {
        paginationControls.classList.remove('hidden');
      } else {
        paginationControls.classList.add('hidden');
      }
    } catch (err) {
      userBookingsList.innerHTML = `<div class="empty-state">Error: ${err.message}</div>`;
      showAlert(err.message, 'error');
    }
  }

  function renderUserBookings(bookings, append) {
    if (!append && bookings.length === 0) {
      userBookingsList.innerHTML = '<div class="empty-state">No bookings found for this email.</div>';
      return;
    }

    const itemsHtml = bookings
      .map(
        (b) => `
      <div class="booking-item" id="booking-item-${b.id}">
        <div class="booking-info">
          <h4>Booking #${escapeHtml(b.id)}</h4>
          <p><strong>Slot ID:</strong> ${escapeHtml(b.slot_id)} · <strong>Patient:</strong> ${escapeHtml(b.name)}</p>
          <p><strong>Created:</strong> ${formatDateTime(b.created_at)}</p>
        </div>
        <div style="display: flex; align-items: center; gap: 12px;">
          <span class="status-pill ${b.status}">${b.status}</span>
          ${
            b.status === 'confirmed'
              ? `<button class="btn btn-danger-outline cancel-item-btn" data-id="${b.id}">Cancel</button>`
              : ''
          }
        </div>
      </div>
    `
      )
      .join('');

    if (append) {
      userBookingsList.insertAdjacentHTML('beforeend', itemsHtml);
    } else {
      userBookingsList.innerHTML = itemsHtml;
    }

    // Attach cancel handlers
    userBookingsList.querySelectorAll('.cancel-item-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-id');
        if (!confirm('Cancel this booking?')) return;

        try {
          const res = await fetch(`/bookings/${id}`, {
            method: 'DELETE',
            headers: {
              'X-API-Key': getApiKey(),
            },
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Failed to cancel');

          showAlert(`Booking #${id} cancelled.`, 'info');
          // Re-fetch bookings & slots
          fetchUserBookings(false);
          loadSlots();
        } catch (err) {
          showAlert(err.message, 'error');
        }
      });
    });
  }

  providerFilter.addEventListener('change', loadSlots);
  refreshSlotsBtn.addEventListener('click', loadSlots);

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initial load
  loadSlots();
});

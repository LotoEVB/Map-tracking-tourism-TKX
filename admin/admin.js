const SUPABASE_URL = "https://djbwtrfxzcvyenahhxpy.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_WYXUvbUsz_qUdb9tnMN6PQ_lb6lQH9E";
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const elements = {
  adminEmail: document.getElementById("admin-email"),
  logoutBtn: document.getElementById("logout-btn"),
  tabButtons: Array.from(document.querySelectorAll(".tab-btn")),
  locationsTab: document.getElementById("locations-tab"),
  usersTab: document.getElementById("users-tab"),
  locationsBody: document.getElementById("locations-body"),
  usersBody: document.getElementById("users-body"),
  modal: document.getElementById("modal"),
  modalTitle: document.getElementById("modal-title"),
  modalBody: document.getElementById("modal-body"),
  modalActions: document.getElementById("modal-actions"),
  modalClose: document.getElementById("modal-close"),
};

const state = {
  session: null,
  user: null,
  role: "visitors",
  locations: [],
  users: [],
};

const APP_ROLES = ["visitors", "publisher", "editor", "admin"];

initialize();

async function initialize() {
  wireEvents();

  const { data } = await supabaseClient.auth.getSession();
  await applySession(data.session);

  supabaseClient.auth.onAuthStateChange(async (_event, session) => {
    await applySession(session);
  });
}

function wireEvents() {
  elements.logoutBtn.addEventListener("click", async () => {
    await supabaseClient.auth.signOut();
    window.location.href = "../index.html";
  });

  elements.tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  elements.modalClose.addEventListener("click", closeModal);
  elements.modal.addEventListener("click", (event) => {
    if (event.target === elements.modal) {
      closeModal();
    }
  });
}

async function applySession(session) {
  state.session = session;
  state.user = session?.user || null;

  if (!state.user) {
    window.location.href = "../index.html";
    return;
  }

  elements.adminEmail.textContent = state.user.email || "admin";

  const { data: roleRow } = await supabaseClient
    .from("user_roles")
    .select("user_role")
    .eq("user_id", state.user.id)
    .maybeSingle();

  state.role = roleRow?.user_role || "visitors";

  if (state.role !== "admin") {
    alert("Този панел е достъпен само за администратори.");
    window.location.href = "../index.html";
    return;
  }

  await Promise.all([loadLocations(), loadUsers()]);
}

function setActiveTab(tabName) {
  elements.tabButtons.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabName));
  elements.locationsTab.classList.toggle("hidden", tabName !== "locations");
  elements.usersTab.classList.toggle("hidden", tabName !== "users");
}

async function loadLocations() {
  const { data, error } = await supabaseClient
    .from("locations")
    .select("id, title, mountain, description, season, visit_date, latitude, longitude, elevation_m")
    .order("visit_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) {
    alert(`Грешка при зареждане на локации: ${error.message}`);
    return;
  }

  state.locations = data || [];
  renderLocations();
}

function renderLocations() {
  if (!state.locations.length) {
    elements.locationsBody.innerHTML = '<tr><td colspan="6">Няма локации.</td></tr>';
    return;
  }

  elements.locationsBody.innerHTML = state.locations
    .map((location) => `
      <tr>
        <td>${escapeHtml(location.title)}</td>
        <td>${escapeHtml(location.mountain || "-")}</td>
        <td>${escapeHtml(location.season || "-")}</td>
        <td>${escapeHtml(location.visit_date ? formatBgDate(location.visit_date) : "-")}</td>
        <td>${Number.isFinite(location.elevation_m) ? `${location.elevation_m} м` : "-"}</td>
        <td>
          <div class="actions">
            <button class="btn btn-secondary" data-loc-edit="${location.id}">Edit</button>
            <button class="btn" data-loc-delete="${location.id}">Delete</button>
          </div>
        </td>
      </tr>
    `)
    .join("");

  elements.locationsBody.querySelectorAll("[data-loc-edit]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const location = state.locations.find((x) => x.id === btn.getAttribute("data-loc-edit"));
      if (location) {
        openLocationEditPopup(location);
      }
    });
  });

  elements.locationsBody.querySelectorAll("[data-loc-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const location = state.locations.find((x) => x.id === btn.getAttribute("data-loc-delete"));
      if (location) {
        openLocationDeletePopup(location);
      }
    });
  });
}

function openLocationEditPopup(location) {
  const content = `
    <form id="admin-edit-location-form" class="form-grid">
      <label>Заглавие<input id="admin-edit-title" value="${escapeHtmlAttr(location.title)}" /></label>
      <label>Височина (м)<input id="admin-edit-elevation" type="number" step="1" value="${Number.isFinite(location.elevation_m) ? location.elevation_m : ""}" /></label>
      <label>Планина<input id="admin-edit-mountain" value="${escapeHtmlAttr(location.mountain || "")}" /></label>
      <label>Описание<textarea id="admin-edit-description" rows="4">${escapeHtml(location.description || "")}</textarea></label>
      <label>Сезон<input id="admin-edit-season" value="${escapeHtmlAttr(location.season || "")}" /></label>
      <label>Дата<input id="admin-edit-date" type="date" value="${location.visit_date || ""}" /></label>
      <label>Latitude<input id="admin-edit-lat" type="number" step="any" value="${formatCoordinate(location.latitude)}" /></label>
      <label>Longitude<input id="admin-edit-lng" type="number" step="any" value="${formatCoordinate(location.longitude)}" /></label>
    </form>
  `;

  openModal("Edit Location", content, [
    { text: "Cancel", className: "btn btn-secondary", onClick: closeModal },
    {
      text: "Save",
      className: "btn",
      onClick: async () => {
        const payload = {
          title: document.getElementById("admin-edit-title").value.trim(),
          mountain: document.getElementById("admin-edit-mountain").value.trim() || null,
          description: document.getElementById("admin-edit-description").value.trim() || null,
          season: document.getElementById("admin-edit-season").value.trim() || null,
          visit_date: document.getElementById("admin-edit-date").value || null,
          latitude: Number(document.getElementById("admin-edit-lat").value),
          longitude: Number(document.getElementById("admin-edit-lng").value),
          elevation_m: parseOptionalInteger(document.getElementById("admin-edit-elevation")?.value),
        };

        const { error } = await supabaseClient.from("locations").update(payload).eq("id", location.id);
        if (error) {
          alert(`Update error: ${error.message}`);
          return;
        }

        closeModal();
        await loadLocations();
      },
    },
  ]);

  const latInput = document.getElementById("admin-edit-lat");
  const lngInput = document.getElementById("admin-edit-lng");
  const elevationInput = document.getElementById("admin-edit-elevation");
  if (latInput && lngInput && elevationInput) {
    const updateElevation = async () => {
      const lat = Number(latInput.value);
      const lng = Number(lngInput.value);
      if (Number.isNaN(lat) || Number.isNaN(lng)) {
        elevationInput.value = "";
        return;
      }

      const elevationM = await fetchElevationMeters(lat, lng);
      elevationInput.value = Number.isFinite(elevationM) ? String(elevationM) : "";
    };

    latInput.addEventListener("change", updateElevation);
    lngInput.addEventListener("change", updateElevation);
  }
}

function openLocationDeletePopup(location) {
  openModal(
    "Delete Location",
    `<p>Сигурни ли сте, че искате да изтриете <strong>${escapeHtml(location.title)}</strong>?</p>`,
    [
      { text: "Cancel", className: "btn btn-secondary", onClick: closeModal },
      {
        text: "Delete",
        className: "btn",
        onClick: async () => {
          const { error } = await supabaseClient.from("locations").delete().eq("id", location.id);
          if (error) {
            alert(`Delete error: ${error.message}`);
            return;
          }

          closeModal();
          await loadLocations();
        },
      },
    ]
  );
}

async function loadUsers() {
  const { data, error } = await supabaseClient.rpc("admin_list_users");
  if (error) {
    alert(`Грешка при зареждане на потребители: ${error.message}`);
    return;
  }

  state.users = data || [];
  renderUsers();
}

function renderUsers() {
  if (!state.users.length) {
    elements.usersBody.innerHTML = '<tr><td colspan="3">Няма потребители.</td></tr>';
    return;
  }

  elements.usersBody.innerHTML = state.users
    .map((user) => {
      const roleOptions = APP_ROLES.map(
        (role) => `<option value="${role}" ${role === user.user_role ? "selected" : ""}>${role}</option>`
      ).join("");
      const isApproved = user.user_role !== "visitors";
      const approveLabel = isApproved ? "Approved" : "Approve";
      const isSelf = user.user_id === state.user?.id;

      return `
      <tr>
        <td>${escapeHtml(user.email || user.user_id)}</td>
        <td>${escapeHtml(user.user_role)}</td>
        <td>
          <div class="actions">
            <button class="btn" data-user-approve="${user.user_id}" ${isApproved ? "disabled" : ""}>${approveLabel}</button>
            <select data-role-select="${user.user_id}">${roleOptions}</select>
            <button class="btn btn-secondary" data-role-save="${user.user_id}">Save Role</button>
            <button class="btn btn-secondary" data-user-password="${user.user_id}" ${isSelf ? "disabled" : ""}>Change Password</button>
            <button class="btn btn-secondary" data-user-delete="${user.user_id}" ${isSelf ? "disabled" : ""}>Delete User</button>
          </div>
        </td>
      </tr>`;
    })
    .join("");

  elements.usersBody.querySelectorAll("[data-role-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetUserId = btn.getAttribute("data-role-save");
      const roleSelect = elements.usersBody.querySelector(`[data-role-select="${targetUserId}"]`);
      const targetRole = roleSelect?.value;

      if (!targetRole) {
        alert("Изберете роля.");
        return;
      }

      const { error } = await supabaseClient.rpc("admin_set_user_role", {
        target_user_id: targetUserId,
        target_role: targetRole,
      });

      if (error) {
        alert(`Role update error: ${error.message}`);
        return;
      }

      await loadUsers();
    });
  });

  elements.usersBody.querySelectorAll("[data-user-approve]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const targetUserId = btn.getAttribute("data-user-approve");

      const { error } = await supabaseClient.rpc("admin_set_user_role", {
        target_user_id: targetUserId,
        target_role: "publisher",
      });

      if (error) {
        alert(`Approve error: ${error.message}`);
        return;
      }

      await loadUsers();
    });
  });

  elements.usersBody.querySelectorAll("[data-user-password]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetUserId = btn.getAttribute("data-user-password");
      const targetUser = state.users.find((item) => item.user_id === targetUserId);
      if (targetUser) {
        openUserPasswordPopup(targetUser);
      }
    });
  });

  elements.usersBody.querySelectorAll("[data-user-delete]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetUserId = btn.getAttribute("data-user-delete");
      const targetUser = state.users.find((item) => item.user_id === targetUserId);
      if (targetUser) {
        openUserDeletePopup(targetUser);
      }
    });
  });
}

function openUserPasswordPopup(user) {
  const userLabel = user.email || user.user_id;
  const content = `
    <form id="admin-user-password-form" class="form-grid">
      <p>Задайте нова парола за <strong>${escapeHtml(userLabel)}</strong>.</p>
      <label>Нова парола<input id="admin-user-new-password" type="password" minlength="8" autocomplete="new-password" /></label>
    </form>
  `;

  const submitPasswordChange = async () => {
    const newPassword = document.getElementById("admin-user-new-password")?.value || "";
    if (newPassword.trim().length < 8) {
      alert("Паролата трябва да е поне 8 символа.");
      return;
    }

    const { error } = await supabaseClient.rpc("admin_set_user_password", {
      target_user_id: user.user_id,
      new_password: newPassword,
    });

    if (error) {
      alert(`Password update error: ${error.message}`);
      return;
    }

    closeModal();
    alert("Паролата е обновена успешно.");
  };

  openModal("Change User Password", content, [
    { text: "Cancel", className: "btn btn-secondary", onClick: closeModal },
    { text: "Save Password", className: "btn", onClick: submitPasswordChange },
  ]);

  const form = document.getElementById("admin-user-password-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitPasswordChange();
  });
}

function openUserDeletePopup(user) {
  const userLabel = user.email || user.user_id;
  openModal(
    "Delete User",
    `<p>Сигурни ли сте, че искате да изтриете потребител <strong>${escapeHtml(userLabel)}</strong>?</p>`,
    [
      { text: "Cancel", className: "btn btn-secondary", onClick: closeModal },
      {
        text: "Delete",
        className: "btn",
        onClick: async () => {
          const { error } = await supabaseClient.rpc("admin_delete_user", {
            target_user_id: user.user_id,
          });

          if (error) {
            alert(`Delete user error: ${error.message}`);
            return;
          }

          closeModal();
          await loadUsers();
        },
      },
    ]
  );
}

function openModal(title, bodyHtml, actions) {
  elements.modalTitle.textContent = title;
  elements.modalBody.innerHTML = bodyHtml;
  elements.modalActions.innerHTML = "";

  actions.forEach((action) => {
    const button = document.createElement("button");
    button.textContent = action.text;
    button.className = action.className || "btn";
    button.addEventListener("click", action.onClick);
    elements.modalActions.appendChild(button);
  });

  elements.modal.classList.remove("hidden");
}

function closeModal() {
  elements.modal.classList.add("hidden");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

async function fetchElevationMeters(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`
    );
    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const elevation = Array.isArray(payload?.elevation) ? payload.elevation[0] : null;
    if (!Number.isFinite(elevation)) {
      return null;
    }

    return Math.round(elevation);
  } catch {
    return null;
  }
}

function parseOptionalInteger(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return Math.round(parsed);
}

function formatBgDate(isoDate) {
  const match = String(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const [, year, month, day] = match;
    return `${day}-${month}-${year}`;
  }

  const date = new Date(String(isoDate));
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }

  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

function formatCoordinate(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "";
  }

  return numericValue.toFixed(4);
}
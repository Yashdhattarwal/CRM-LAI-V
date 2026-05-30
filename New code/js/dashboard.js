// dashboard.js

const navItems = document.querySelectorAll('.nav-item');
const viewDashboard = document.getElementById('view-dashboard');
const viewForm = document.getElementById('view-form');
const formTitle = document.getElementById('form-title');
const formContent = document.getElementById('form-content');

// Form definitions for the different sections based on original functionalities
const forms = {
    shops: {
        title: "Add New Shop",
        html: `
            <div class="grid" style="grid-template-columns:1fr 1fr; gap:1.5rem;">
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Store Name</label>
                    <input type="text" class="input-control" placeholder="Downtown Store" />
                </div>
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Phone Number</label>
                    <input type="text" class="input-control" placeholder="(555) 123-4567" />
                </div>
                <div style="grid-column: 1 / -1">
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Store Address</label>
                    <input type="text" class="input-control" placeholder="123 Main St" />
                </div>
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">City</label>
                    <input type="text" class="input-control" placeholder="City" />
                </div>
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">State</label>
                    <input type="text" class="input-control" placeholder="State" />
                </div>
            </div>
        `
    },
    scanner: {
        title: "Buy Scanner Hardware",
        html: `
            <div class="flex items-center gap-4" style="margin-bottom:2rem;">
                <div class="card" style="flex:1; border:2px solid var(--primary); cursor:pointer;">
                    <div style="font-weight:600; font-size:1.1rem; margin-bottom:0.5rem;">1D Scanner</div>
                    <div class="text-sec">Standard barcode scanner for states with 1D tickets.</div>
                    <div style="margin-top:1rem; font-weight:700; font-size:1.2rem;">$129</div>
                </div>
                <div class="card" style="flex:1; border:1px solid var(--border); cursor:pointer;">
                    <div style="font-weight:600; font-size:1.1rem; margin-bottom:0.5rem;">2D Scanner</div>
                    <div class="text-sec">Advanced scanner for QR and 2D ticket codes.</div>
                    <div style="margin-top:1rem; font-weight:700; font-size:1.2rem;">$199</div>
                </div>
            </div>
            <div>
                <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Shipping Address</label>
                <input type="text" class="input-control" value="123 Main St, City, State" />
            </div>
        `
    },
    renewal: {
        title: "Subscription Renewal",
        html: `
            <div style="background:rgba(16, 185, 129, 0.1); color:var(--success); padding:1rem; border-radius:6px; margin-bottom:1.5rem; font-weight:500;">
                Your current subscription is active until Oct 31, 2024.
            </div>
            <div class="grid" style="grid-template-columns:1fr 1fr; gap:1.5rem; margin-bottom:1.5rem;">
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Billing Cycle</label>
                    <select class="input-control">
                        <option>Monthly - $49/mo</option>
                        <option>Annually - $490/yr (Save ~16%)</option>
                    </select>
                </div>
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Payment Method</label>
                    <select class="input-control">
                        <option>Last Used (Visa **1234)</option>
                        <option>New Credit Card</option>
                        <option>eCheck / ACH</option>
                    </select>
                </div>
            </div>
        `
    },
    profile: {
        title: "Edit Profile",
        html: `
            <div class="grid" style="grid-template-columns:1fr 1fr; gap:1.5rem;">
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">First Name</label>
                    <input type="text" class="input-control" value="Sahil" />
                </div>
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Last Name</label>
                    <input type="text" class="input-control" value="K" />
                </div>
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Email Address</label>
                    <input type="email" class="input-control" value="sahil@example.com" />
                </div>
                <div>
                    <label class="text-sec" style="font-size:0.9rem; margin-bottom:0.5rem; display:block;">Mobile No</label>
                    <input type="text" class="input-control" value="(555) 987-6543" />
                </div>
            </div>
        `
    },
    settings: {
        title: "Account Settings",
        html: `
            <div>
                <div class="flex items-center justify-between" style="padding-bottom:1rem; border-bottom:1px solid var(--border); margin-bottom:1rem;">
                    <div>
                        <div style="font-weight:600;">Email Notifications</div>
                        <div class="text-sec" style="font-size:0.85rem;">Receive daily shift reports by email.</div>
                    </div>
                    <input type="checkbox" checked style="width:20px; height:20px;" />
                </div>
                <div class="flex items-center justify-between" style="padding-bottom:1rem; border-bottom:1px solid var(--border); margin-bottom:1rem;">
                    <div>
                        <div style="font-weight:600;">Auto-Renewal</div>
                        <div class="text-sec" style="font-size:0.85rem;">Automatically renew subscription at end of term.</div>
                    </div>
                    <input type="checkbox" checked style="width:20px; height:20px;" />
                </div>
                <div class="flex items-center justify-between">
                    <div>
                        <div style="font-weight:600;">Dark Theme</div>
                        <div class="text-sec" style="font-size:0.85rem;">Enable dark mode for dashboard UI.</div>
                    </div>
                    <input type="checkbox" style="width:20px; height:20px;" />
                </div>
            </div>
        `
    }
}

navItems.forEach(item => {
    item.addEventListener('click', (e) => {
        e.preventDefault();
        
        // Remove active class from all
        navItems.forEach(nav => nav.classList.remove('active'));
        // Add active to clicked
        item.classList.add('active');

        const target = item.getAttribute('data-target');

        // Render appropriate view
        if (target === 'dashboard') {
            viewDashboard.style.display = 'block';
            viewForm.style.display = 'none';
            document.getElementById('page-title').textContent = "Welcome back, Sahil";
            document.getElementById('page-subtitle').textContent = "Downtown Store Dashboard";
        } else if (forms[target]) {
            viewDashboard.style.display = 'none';
            viewForm.style.display = 'block';
            
            formTitle.textContent = forms[target].title;
            formContent.innerHTML = forms[target].html;

            document.getElementById('page-title').textContent = forms[target].title;
            document.getElementById('page-subtitle').textContent = "Manage your account and preferences";
        }
    });
});

document.getElementById('form-cancel').addEventListener('click', () => {
    // Return to dashboard
    navItems[0].click();
});

document.getElementById('form-submit').addEventListener('click', () => {
    // Mock save logic
    const btn = document.getElementById('form-submit');
    const originalText = btn.textContent;
    btn.textContent = "Saving...";
    btn.style.opacity = "0.7";

    setTimeout(() => {
        btn.textContent = "Saved Successfully!";
        btn.style.backgroundColor = "var(--success)";
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = "var(--primary)";
            btn.style.opacity = "1";
        }, 2000);
    }, 800);
});

// landing.js
document.addEventListener('DOMContentLoaded', () => {
    // FAQ Accordion
    document.querySelectorAll('.faq-btn-new').forEach(btn => {
        btn.addEventListener('click', () => {
            const item = btn.closest('.faq-item-new');
            const isOpen = item.classList.contains('open');
            
            // Close all other items
            document.querySelectorAll('.faq-item-new').forEach(i => i.classList.remove('open'));
            
            // Toggle current item
            if (!isOpen) {
                item.classList.add('open');
                btn.setAttribute('aria-expanded', 'true');
            } else {
                btn.setAttribute('aria-expanded', 'false');
            }
        });
    });

    // Mobile Nav Toggle (if needed)
    // ...
});

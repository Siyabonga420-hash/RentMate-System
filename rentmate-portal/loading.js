/* RENTMATE SHARED LOADING INDICATORS */

(() => {
    const active = new WeakSet();

    function setLoading(button, loading) {
        if (!button) return;

        if (loading) {
            if (active.has(button)) return;

            active.add(button);

            button.dataset.rmOriginalText = button.textContent;
            button.dataset.rmWasDisabled = String(button.disabled);

            button.disabled = true;
            button.setAttribute('aria-busy', 'true');

            button.innerHTML =
                '<span class="rm-spinner" aria-hidden="true"></span>' +
                '<span>Processing...</span>';

        } else {
            if (!active.has(button)) return;

            active.delete(button);

            button.textContent =
                button.dataset.rmOriginalText || 'Submit';

            button.disabled =
                button.dataset.rmWasDisabled === 'true';

            button.removeAttribute('aria-busy');

            delete button.dataset.rmOriginalText;
            delete button.dataset.rmWasDisabled;
        }
    }

    async function run(button, operation) {
        if (!button || active.has(button)) return;

        setLoading(button, true);

        try {
            return await operation();
        } finally {
            setLoading(button, false);
        }
    }

    window.RentMateLoading = {
        run,
        setLoading
    };
})();
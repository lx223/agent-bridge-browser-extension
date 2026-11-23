{
  const settings = document.currentScript?.dataset ?? {};
  const pending = [];
  let posthog;

  const track = (event, properties, options) => {
    if (!settings.posthogKey) return;
    if (posthog) posthog.capture(event, properties, options);
    else pending.push([event, properties, options]);
  };

  const placementOf = (element) => element.closest('[data-area]')?.dataset.area ?? 'content';

  const assetsHost = (apiHost) => apiHost.replace(/^https:\/\/(\w+)\.i\.posthog\.com$/, 'https://$1-assets.i.posthog.com');

  const startAnalytics = () => {
    if (!settings.posthogKey || !settings.posthogHost) return;
    const loader = document.createElement('script');
    loader.src = `${assetsHost(settings.posthogHost)}/static/array.js`;
    loader.async = true;
    loader.addEventListener('load', () => {
      window.posthog?.init(settings.posthogKey, {
        api_host: settings.posthogHost,
        cookieless_mode: 'always',
        person_profiles: 'never',
        autocapture: false,
        capture_pageview: true,
        capture_pageleave: true,
        capture_performance: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        rageclick: false,
        enable_heatmaps: false,
        disable_session_recording: true,
        disable_surveys: true,
        disable_product_tours: true,
        disable_conversations: true,
        disable_web_experiments: true,
        advanced_disable_flags: true,
        disable_external_dependency_loading: true,
        before_send: (event) => {
          if (event) event.properties = { ...event.properties, app: settings.app };
          return event;
        },
        loaded: (instance) => {
          posthog = instance;
          for (const args of pending.splice(0)) instance.capture(...args);
        },
      });
    });
    document.head.append(loader);
  };

  const addCopyButtons = () => {
    for (const pre of document.querySelectorAll('pre[data-snippet]')) {
      const wrapper = document.createElement('div');
      wrapper.className = 'code-block';
      pre.replaceWith(wrapper);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy';
      button.textContent = 'Copy';
      button.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(pre.textContent ?? '');
        } catch {
          return;
        }
        button.textContent = 'Copied';
        setTimeout(() => (button.textContent = 'Copy'), 2000);
        track('site_snippet_copied', { snippet: pre.dataset.snippet, method: 'button' });
      });
      wrapper.append(pre, button);
    }
  };

  document.addEventListener('copy', () => {
    const node = document.getSelection()?.anchorNode;
    const element = node instanceof Element ? node : node?.parentElement;
    const pre = element?.closest('pre[data-snippet]');
    if (pre) track('site_snippet_copied', { snippet: pre.dataset.snippet, method: 'selection' });
  });

  document.addEventListener('click', (event) => {
    const link = event.target instanceof Element ? event.target.closest('a[data-track]') : null;
    if (!link) return;
    track('site_link_clicked', { target: link.dataset.track, placement: placementOf(link) }, { transport: 'sendBeacon' });
  });

  const watchInstallSection = () => {
    const heading = document.getElementById('install');
    if (!heading || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      track('site_install_viewed');
    });
    observer.observe(heading);
  };

  addCopyButtons();
  watchInstallSection();
  startAnalytics();
}

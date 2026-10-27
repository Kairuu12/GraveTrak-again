export function routeLocationErrorMessage(error) {
  if (error?.code === 1) return 'Location permission was denied. Enable location access in your browser.';
  if (error?.code === 3) return 'Location request timed out. Try again with a stronger GPS signal.';
  if (error?.code === 'insecure') return 'Live location requires HTTPS or localhost.';
  if (error?.code === 'unsupported') return 'This browser does not support live location.';
  return 'Your location is currently unavailable. Check your device location settings.';
}

export function requestRoutePosition(onSuccess, onError, {
  signal, geolocation = globalThis.navigator?.geolocation, secureContext = globalThis.isSecureContext,
} = {}) {
  const fail = error => { if (!signal?.aborted) onError(error); };
  if (signal?.aborted) return;
  if (secureContext === false) return fail({ code: 'insecure' });
  if (!geolocation) return fail({ code: 'unsupported' });
  const attempt = retry => {
    try {
      geolocation.getCurrentPosition(position => {
        if (signal?.aborted) return;
        const { latitude, longitude } = position.coords || {};
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
          fail({ code: 2 });
          return;
        }
        onSuccess(position);
      }, error => {
        if (signal?.aborted) return;
        if (!retry && [2, 3].includes(error.code)) attempt(true);
        else fail(error);
      }, retry ? { enableHighAccuracy: false, timeout: 10000, maximumAge: 30000 }
        : { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 });
    } catch (error) {
      fail(error.name === 'SecurityError' ? { code: 1 } : error);
    }
  };
  attempt(false);
}

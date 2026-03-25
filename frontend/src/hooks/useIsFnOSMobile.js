import { useState, useEffect } from 'react';

export const useIsFnOSMobile = () => {
  const [isFnOSMobile, setIsFnOSMobile] = useState(false);

  useEffect(() => {
    const checkFnOS = () => {
      const ua = navigator.userAgent.toLowerCase();
      // Check for FnOS specific keywords in User Agent or window object
      // Common indicators for FnOS/Trim app
      const isApp = 
        ua.includes('fnos') || 
        ua.includes('trim') || 
        // Some webviews inject specific objects
        window.fnos !== undefined ||
        window.trim !== undefined;

      // Ensure it is mobile
      const isMobile = /iphone|ipad|ipod|android|mobile/.test(ua);

      setIsFnOSMobile(isApp && isMobile);
    };

    checkFnOS();
  }, []);

  return isFnOSMobile;
};

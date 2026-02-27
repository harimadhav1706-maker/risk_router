document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Leaflet Map
    const map = L.map('map', {
        zoomControl: false
    }).setView([17.4065, 78.4772], 13);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Clean light theme map tiles with natural colors (CartoDB Voyager)
    const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
        subdomains: 'abcd',
        maxZoom: 20
    }).addTo(map);

    // Real Routing and Search Logic
    const checkRouteBtnDesktop = document.getElementById('check-route-btn');
    const distVal = document.getElementById('dist-val');
    const timeVal = document.getElementById('time-val');

    // New Navigation UI Elements
    const startNavBtn = document.getElementById('start-nav-btn');
    const directionsPanel = document.getElementById('directions-panel');
    const routingInstructions = document.getElementById('routing-instructions');
    const vehicleBtns = document.querySelectorAll('.vehicle-btn');

    let routingControl = null;
    let selectedVehicle = 'driving';

    // Navigation State handling
    let isNavigating = false;
    let navWatchId = null;
    let navRoutePolyline = null;
    let navEndLatLng = null;
    let routeInstructions = [];
    let userMarker = null;

    const navBanner = document.getElementById('nav-banner');
    const stopNavBtn = document.getElementById('stop-nav-btn');
    const navInstruction = document.getElementById('nav-instruction');
    const navDistance = document.getElementById('nav-distance');
    const navStatus = document.getElementById('nav-status');

    const navBottomCard = document.getElementById('nav-bottom-card');
    const secondaryInstBox = document.getElementById('secondary-instruction-box');
    const navSecondaryText = document.getElementById('nav-secondary-text');
    const primaryIconBox = document.getElementById('primary-direction-icon');
    const secondaryIconBox = document.getElementById('secondary-direction-icon');
    const navEtaTime = document.getElementById('nav-eta-time');
    const navEtaDistance = document.getElementById('nav-eta-distance');
    const navEtaArrival = document.getElementById('nav-eta-arrival');

    let lastUserPos = null;

    const navIcons = {
        straight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m0-16l-4 4m4-4l4 4"/></svg>`,
        left: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>`,
        right: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 5l-7 7 7 7"/></svg>`,
        u_turn: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M10 9a4 4 0 1 1 8 0v7M10 9L6 13M10 9l4 4"/></svg>`,
        destination: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M12 21s8-9 8-14a8 8 0 1 0-16 0c0 5 8 14 8 14z"/><circle cx="12" cy="7" r="3"/></svg>`
    };

    function getIconForStep(step) {
        if (!step || !step.text) return navIcons.straight;
        let t = step.text.toLowerCase();
        if (t.includes('arrive') || t.includes('destination')) return navIcons.destination;
        if (t.includes('u-turn')) return navIcons.u_turn;
        if (t.includes('left')) return navIcons.left;
        if (t.includes('right')) return navIcons.right;
        return navIcons.straight;
    }

    if (stopNavBtn) {
        stopNavBtn.addEventListener('click', stopNavigationMode);
    }

    // Handle vehicle selection
    vehicleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            vehicleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            selectedVehicle = btn.getAttribute('data-vehicle') || 'driving';
            // If there's an active route on map, recalculate it
            if (routingControl) {
                calculateRealRoute();
            }
        });
    });

    function startNavigationMode() {
        if (!routingControl || !navRoutePolyline) return;

        isNavigating = true;
        document.body.classList.add('nav-mode');

        if (navBanner) {
            navBanner.classList.add('active');
            if (navStatus) {
                navStatus.innerText = "En Route";
                navStatus.classList.remove('rerouting');
            }
        }
        if (navBottomCard) navBottomCard.classList.add('active');

        map.setZoom(18);
        map.dragging.disable();
        map.touchZoom.disable();
        map.doubleClickZoom.disable();
        map.scrollWheelZoom.disable();

        // Prevent dragging the route markers during navigation
        if (routingControl) {
            routingControl.getPlan().setWaypoints(routingControl.getPlan().getWaypoints()); // locks it by re-setting internally sometimes
        }

        // Start GPS tracking
        if (navigator.geolocation) {
            navWatchId = navigator.geolocation.watchPosition(
                updateNavigationUI,
                (error) => console.error("GPS Error:", error),
                { enableHighAccuracy: true, maximumAge: 0 }
            );
        } else {
            alert("Geolocation is not supported by your browser.");
        }
    }

    function stopNavigationMode() {
        isNavigating = false;
        document.body.classList.remove('nav-mode');

        if (navBanner) navBanner.classList.remove('active');
        if (navBottomCard) navBottomCard.classList.remove('active');
        lastUserPos = null;

        map.dragging.enable();
        map.touchZoom.enable();
        map.doubleClickZoom.enable();
        map.scrollWheelZoom.enable();

        if (navWatchId !== null) {
            navigator.geolocation.clearWatch(navWatchId);
            navWatchId = null;
        }

        // Fit map back to route
        if (navRoutePolyline && navRoutePolyline.length > 0) {
            map.fitBounds(L.latLngBounds(navRoutePolyline), { padding: [50, 50] });
        }

        if (startNavBtn) {
            startNavBtn.innerHTML = "🚀 Start Navigation";
            startNavBtn.onclick = startNavigationMode;
        }
    }

    function getDistanceFromPolyline(latlng, polyline) {
        let minMeters = Infinity;
        for (let i = 0; i < polyline.length; i++) {
            const d = latlng.distanceTo(polyline[i]);
            if (d < minMeters) minMeters = d;
        }
        return minMeters;
    }

    function getBearing(start, end) {
        const startLat = start.lat * Math.PI / 180;
        const startLng = start.lng * Math.PI / 180;
        const endLat = end.lat * Math.PI / 180;
        const endLng = end.lng * Math.PI / 180;
        const y = Math.sin(endLng - startLng) * Math.cos(endLat);
        const x = Math.cos(startLat) * Math.sin(endLat) -
            Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLng - startLng);
        const brng = Math.atan2(y, x);
        return (brng * 180 / Math.PI + 360) % 360;
    }

    function updateNavigationUI(position) {
        if (!isNavigating || !navRoutePolyline) return;

        const userLatLng = L.latLng(position.coords.latitude, position.coords.longitude);

        let heading = 0;
        if (lastUserPos) {
            heading = getBearing(lastUserPos, userLatLng);
        } else if (position.coords.heading) {
            heading = position.coords.heading;
        }
        lastUserPos = userLatLng;

        // Ensure we center properly (with panBy we could offset if needed, but panTo is safer)
        map.panTo(userLatLng, { animate: true });

        // Update User Marker
        if (userMarker) {
            userMarker.setLatLng(userLatLng);
            const iconElement = userMarker.getElement();
            if (iconElement) {
                const inner = iconElement.querySelector('.nav-user-marker');
                if (inner) inner.style.transform = `rotate(${heading}deg)`;
            }
        } else {
            userMarker = L.marker(userLatLng, {
                icon: L.divIcon({
                    className: '',
                    html: `<div class="nav-user-marker" style="transform: rotate(${heading}deg)"></div>`,
                    iconSize: [32, 32],
                    iconAnchor: [16, 16]
                })
            }).addTo(map);
        }

        // Check off-route > 50 meters
        const distToRoute = getDistanceFromPolyline(userLatLng, navRoutePolyline);
        if (distToRoute > 50) {
            reRoute(userLatLng);
            return;
        }

        // Find current step based on distance to instruction points
        if (routeInstructions && routeInstructions.length > 0) {
            let closestInst = null;
            let minDist = Infinity;

            for (let i = 0; i < routeInstructions.length; i++) {
                let inst = routeInstructions[i];
                let instLatLng = navRoutePolyline[inst.index];
                if (instLatLng) {
                    let d = userLatLng.distanceTo(instLatLng);
                    // LRM lists steps chronologically, we want the closest upcoming one typically. 
                    // This is a simple estimation by closest point
                    if (d < minDist) {
                        minDist = d;
                        closestInst = i;
                    }
                }
            }

            if (closestInst !== null && routeInstructions[closestInst]) {
                const step = routeInstructions[closestInst];
                if (navInstruction) navInstruction.innerText = step.text;
                if (primaryIconBox) primaryIconBox.innerHTML = getIconForStep(step);

                let distStr = minDist > 1000 ? (minDist / 1000).toFixed(1) + ' km' : Math.round(minDist) + ' m';
                if (navDistance) navDistance.innerText = distStr;

                // Secondary Instruction Box
                if (routeInstructions[closestInst + 1] && secondaryInstBox) {
                    secondaryInstBox.classList.add('active');
                    if (navSecondaryText) navSecondaryText.innerText = routeInstructions[closestInst + 1].text;
                    if (secondaryIconBox) secondaryIconBox.innerHTML = getIconForStep(routeInstructions[closestInst + 1]);
                } else if (secondaryInstBox) {
                    secondaryInstBox.classList.remove('active');
                }
            }
        }
    }

    function reRoute(currentLatLng) {
        if (navStatus && navStatus.innerText === "Re-routing...") return; // Prevent multiple calls

        if (navStatus) {
            navStatus.innerText = "Re-routing...";
            navStatus.classList.add('rerouting');
        }
        if (navInstruction) navInstruction.innerText = "Calculating new route...";
        if (navDistance) navDistance.innerText = "--";
        if (secondaryInstBox) secondaryInstBox.classList.remove('active');
        if (primaryIconBox) primaryIconBox.innerHTML = navIcons.straight;

        if (routingControl && navEndLatLng) {
            routingControl.setWaypoints([
                currentLatLng,
                navEndLatLng
            ]);
        }
    }

    async function getCoordinates(query) {
        try {
            // Check if query is exact lat,lng formatting (from My Location)
            const latLngMatch = query.match(/^(-?\d+(\.\d+)?),\s*(-?\d+(\.\d+)?)$/);
            if (latLngMatch) {
                return L.latLng(parseFloat(latLngMatch[1]), parseFloat(latLngMatch[3]));
            }

            // Nominatim requires specific headers sometimes, adding a mild delay and ensuring string encoding
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`, {
                headers: {
                    "Accept": "application/json"
                }
            });
            const data = await res.json();
            if (data && data.length > 0) {
                // IMPORTANT: Parse floats
                return L.latLng(parseFloat(data[0].lat), parseFloat(data[0].lon));
            }
        } catch (error) {
            console.error("Geocoding Error: ", error);
        }
        return null;
    }

    function updateRouteUI(distKm, timeMins) {
        const routePanel = document.getElementById('route-panel');
        if (routePanel) routePanel.style.display = 'block';

        if (distVal) distVal.innerText = `${distKm} km`;
        if (timeVal) timeVal.innerText = `${timeMins} mins`;
    }

    async function calculateRealRoute() {
        const startInput = document.getElementById('start-loc').value;
        const endInput = document.getElementById('end-loc').value;

        if (!startInput || !endInput) {
            alert("Please enter both start and destination locations.");
            return;
        }

        const btn = checkRouteBtnDesktop;
        if (btn) {
            btn.innerHTML = "Finding Route...";
            btn.disabled = true;
            btn.style.opacity = "0.7";
        }

        const startLatLng = await getCoordinates(startInput);
        const endLatLng = await getCoordinates(endInput);

        if (!startLatLng || !endLatLng) {
            alert(`Could not pinpoint exact location for ${!startLatLng ? '"' + startInput + '"' : '"' + endInput + '"'}. Please try adding a city name (e.g. "Gachibowli, Hyderabad").`);
            if (btn) {
                btn.innerHTML = "Check Route Safety";
                btn.disabled = false;
                btn.style.opacity = "1";
            }
            return;
        }

        if (routingControl) {
            map.removeControl(routingControl);
        }

        routingControl = L.Routing.control({
            waypoints: [
                startLatLng,
                endLatLng
            ],
            routeWhileDragging: !isNavigating, // disable dragging when navigating
            addWaypoints: !isNavigating,
            showAlternatives: !isNavigating,
            fitSelectedRoutes: !isNavigating,
            router: L.Routing.osrmv1({
                serviceUrl: 'https://router.project-osrm.org/route/v1',
                profile: selectedVehicle
            }),
            lineOptions: {
                styles: [{ color: '#2563EB', opacity: 0.9, weight: 4 }]
            },
            createMarker: function (i, wp, nWps) {
                return L.marker(wp.latLng, {
                    draggable: !isNavigating,
                    icon: L.divIcon({
                        className: 'route-endpoints',
                        html: `<div style="background-color: ${i === 0 ? '#10B981' : '#EF4444'}; width: 22px; height: 22px; border-radius: 50%; border: 3px solid white; box-shadow: 0 4px 10px rgba(0,0,0,0.1); display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: bold; color: white;">↔</div>`,
                        iconSize: [22, 22],
                        iconAnchor: [11, 11]
                    })
                });
            }
        }).on('routesfound', function (e) {
            const routes = e.routes;
            const route = routes[0];
            const summary = route.summary;

            // Capture exact route polyline points and instructions for navigation
            navRoutePolyline = route.coordinates;
            routeInstructions = route.instructions;

            // Re-capture exact destination if it was dragged
            const wps = routingControl.getWaypoints();
            if (wps && wps.length > 1) {
                navEndLatLng = wps[wps.length - 1].latLng;
            } else {
                navEndLatLng = endLatLng;
            }

            // distance in km, time in mins
            const distKm = (summary.totalDistance / 1000).toFixed(1);
            const timeMins = Math.round(summary.totalTime / 60);

            // Trigger the UI updates
            updateRouteUI(distKm, timeMins);

            // Update Bottom ETA Box
            if (navEtaTime) navEtaTime.innerText = timeMins + " min";
            if (navEtaDistance) navEtaDistance.innerText = distKm + " km";

            const now = new Date();
            now.setMinutes(now.getMinutes() + timeMins);
            const arrStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            if (navEtaArrival) navEtaArrival.innerText = arrStr;

            // If navigating, restore status and time after reroute
            if (isNavigating) {
                if (navStatus) {
                    navStatus.innerText = "En Route";
                    navStatus.classList.remove('rerouting');
                }
            }

            if (btn) {
                btn.innerHTML = "Get Directions";
                btn.disabled = false;
                btn.style.opacity = "1";
            }

            // Show Start Navigation button & attach instructions only if not already navigating
            if (startNavBtn && !isNavigating) {
                startNavBtn.style.display = 'block';
                startNavBtn.innerHTML = "🚀 Start Navigation";
                startNavBtn.onclick = startNavigationMode;
            }

            // Hide default directions panel
            if (directionsPanel) directionsPanel.style.display = 'none';

        }).on('routingerror', function (e) {
            console.error("Routing Error:", e);
            alert("Could not find a valid driving route between these two locations. They might be too far, disconnected, or across bodies of water.");
            if (btn) {
                btn.innerHTML = "Get Directions";
                btn.disabled = false;
                btn.style.opacity = "1";
            }
        }).addTo(map);
    }

    if (checkRouteBtnDesktop) checkRouteBtnDesktop.addEventListener('click', calculateRealRoute);

    // Single Location Search (Mobile or General)
    const mobileSearchInput = document.querySelector('.mobile-search-bar .search-input');
    const mobileSearchBtn = document.querySelector('.mobile-search-bar .icon-btn');
    let searchMarker = null;

    async function searchSingleLocation(query) {
        if (!query) return;
        const coords = await getCoordinates(query);
        if (coords) {
            map.setView(coords, 14);
            if (searchMarker) map.removeLayer(searchMarker);
            searchMarker = L.marker(coords, {
                icon: L.divIcon({
                    className: 'search-marker',
                    html: `<div style="background-color: #3B82F6; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.5);"></div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                })
            }).addTo(map).bindPopup(`<b>Location found</b><br>${query}`).openPopup();
        } else {
            alert("Location not found.");
        }
    }

    if (mobileSearchBtn && mobileSearchInput) {
        mobileSearchBtn.addEventListener('click', () => searchSingleLocation(mobileSearchInput.value));
        mobileSearchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchSingleLocation(mobileSearchInput.value);
        });
    }

    // Mobile bottom panel slide-up interaction
    const sidePanel = document.getElementById('side-panel');
    let panelState = 'open';

    if (window.innerWidth <= 768 && sidePanel) {
        const handle = document.getElementById('mobile-handle');
        if (handle) {
            handle.addEventListener('click', () => {
                if (panelState === 'open') {
                    sidePanel.style.transform = `translateY(calc(100% - 40px))`;
                    panelState = 'collapsed';
                } else {
                    sidePanel.style.transform = `translateY(0)`;
                    panelState = 'open';
                }
            });
        }
    }
    // Resize map when window resets
    window.addEventListener('resize', () => {
        map.invalidateSize();
    });

    // Geolocation / Locate Me functionality
    const locateBtn = document.getElementById('locate-btn');

    if (locateBtn) {
        locateBtn.addEventListener('click', () => {
            if (navigator.geolocation) {
                locateBtn.innerHTML = "⏳ Locating...";
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        const lat = position.coords.latitude;
                        const lng = position.coords.longitude;
                        const userLatLng = L.latLng(lat, lng);

                        map.setView(userLatLng, 15);

                        if (userMarker) {
                            map.removeLayer(userMarker);
                        }

                        userMarker = L.marker(userLatLng, {
                            icon: L.divIcon({
                                className: 'user-marker',
                                html: `<div style="background-color: #10B981; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 15px rgba(16,185,129,0.3);"></div>`,
                                iconSize: [24, 24],
                                iconAnchor: [12, 12]
                            })
                        }).addTo(map).bindPopup(`<b>You are here</b>`).openPopup();

                        // Automatically populate the Start location input
                        const startLocInput = document.getElementById('start-loc');
                        if (startLocInput) {
                            startLocInput.value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
                        }

                        locateBtn.innerHTML = "📍 My Location";
                    },
                    (error) => {
                        console.error(error);
                        alert("Could not get your location. Please ensure location permissions are granted.");
                        locateBtn.innerHTML = "📍 My Location";
                    },
                    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
                );
            } else {
                alert("Geolocation is not supported by your browser.");
            }
        });
    }
});

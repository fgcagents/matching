let itineraryList = [];
let idToTrainMap = new Map();
let map;
let markersLayer = L.layerGroup();
// Mapa per guardar colors personalitzats per nom de tren
let trainColorMap = new Map();

// Funcions per gestionar la persistència dels colors
function saveTrainColors() {
  const colors = {};
  trainColorMap.forEach((value, key) => {
    colors[key] = value;
  });
  localStorage.setItem('trainColors', JSON.stringify(colors));
}

function loadTrainColors() {
  const colors = localStorage.getItem('trainColors');
  if (colors) {
    const parsed = JSON.parse(colors);
    trainColorMap = new Map(Object.entries(parsed));
  }
}

const trainIcon = L.divIcon({
    html: `<div style="font-size: 24px;">🚆</div>`,
    className: 'train-marker',
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  // Inicializar el mapa
  function initMap() {
    if (!map) {
      map = L.map("map", {
      zoomControl: false
    }).setView([41.50835446830866,2.0292688204944476], 11);

      // Capa base de JAWS
      L.tileLayer('https://tile.jawg.io/43965150-ada4-4b5a-ac7a-b55f76fb8da7/{z}/{x}/{y}{r}.png?access-token=aDtkeyf8BaiAQcpFkFzvBps7HS77uBqI7R6ueHmKR7pYrYBExgKAUUPmRj358SnC', {
         attribution: "&copy; J_E_O <a href=\"https://www.jawg.io?utm_medium=map&utm_source=attribution\" target=\"_blank\">&copy; Jawg</a> - <a href=\"https://www.openstreetmap.org?utm_medium=map-attribution&utm_source=jawg\" target=\"_blank\">&copy; OpenStreetMap</a>&nbsp;contributors"
      }).addTo(map);


      // Capa de vías férreas de OpenRailwayMap 
      L.tileLayer('https://tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openrailwaymap.org/">OpenRailwayMap</a>',
        maxZoom: 19,
        opacity: 0.7
      }).addTo(map);


      markersLayer.addTo(map);
    }
  }

  // Función fetchAllTrains para descargar el geojson desde la web
  async function fetchAllTrains() {
    try {
        console.log('Iniciando fetchAllTrains...');
        const response = await fetch('https://geotren.fgc.cat/tracker/trens.geojson');
        
        if (!response.ok) {
            console.error('Error en la descarga del fitxer:', response.status);
            return [];
        }
        
        const data = await response.json();
        const trains = data.features.map(feature => ({
            ...feature.properties,
            coordinates: feature.geometry.coordinates
        }));
        
        console.log('Trenes descargados:', trains.length);
        console.log('Muestra de datos:', trains[0]);
        
        return trains;
    } catch (error) {
        console.error('Error al descargar el fitxer:', error);
        return [];
    }
  }

  function parseHora(horaStr) {
    const [h, m] = horaStr.split(":").map(Number);
    return new Date(0, 0, 0, h, m);
  }

  function getHoraActual() {
    const now = new Date();
    return new Date(0, 0, 0, now.getHours(), now.getMinutes());
  }

  function parseProperesParades(properes) {
    try {
        // Si ya es un array (como en el JSON), simplemente mapeamos los valores
        if (Array.isArray(properes)) {
            return properes.map(p => p.parada);
        }
        // Por compatibilidad, mantenemos el parseo de string si viene en el formato antiguo
        const parades = "[" + properes + "]";
        return JSON.parse(parades.replace(/;/g, ",")).map(p => p.parada);
    } catch (error) {
        console.error('Error parseando paradas:', error);
        return [];
    }
}

// Funciones de conversión de tiempo
const timeToMinutes = timeStr => {
  if (!timeStr) return null;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
};

// Función para ordenar resultados basados en la hora
const sortResultsByTime = results => {
  return results.sort((a, b) => {
      const timeA = timeToMinutes(a.hora);
      const timeB = timeToMinutes(b.hora);
      if (timeA === null) return 1;
      if (timeB === null) return -1;
      const adjustedTimeA = timeA < 240 ? timeA + 1440 : timeA;
      const adjustedTimeB = timeB < 240 ? timeB + 1440 : timeB;
      return adjustedTimeA - adjustedTimeB;
  });
};

// Sustitución de la función getOrderedtIinerary
function getOrderedItinerary(train) {
  const parades = [];

  // Primera pasada para recoger todas las paradas
  for (const [key, value] of Object.entries(train)) {
      if (!["A/D", "Linia", "Tren"].includes(key) && value) {
          parades.push({
              estacio: key,
              hora: value
          });
      }
  }

  // Ordenar las paradas usando sortResultsByTime
  return sortResultsByTime(parades);
  
}
  function verificarSecuenciaParadas(properes, itinerario, estacioActual) {
    if (properes.length === 0 || itinerario.length === 0) return false;
    
    const indexActual = itinerario.findIndex(p => p.estacio === estacioActual);
    if (indexActual === -1) return false;
    
    let coincidencias = 0;
    let minCoincidenciasRequeridas = Math.min(2, properes.length);
    
    for (let i = 0; i < properes.length; i++) {
      const indexItinerario = indexActual + i + 1;
      if (indexItinerario >= itinerario.length) break;
      
      if (properes[i] === itinerario[indexItinerario].estacio) {
        coincidencias++;
        if (coincidencias >= minCoincidenciasRequeridas) return true;
      } else {
        break;
      }
    }
    
    return false;
  }

  function matchTrains(itineraryList, apiTrains, horaActual) {
    const matches = [];
    const matchedTrains = new Set();
    const liniesRequerides = ["R5", "R6", "S3", "S4", "S8", "S9", "L8"];

    for (const api of apiTrains) {
        const apiId = api.id;
        const liniaApi = api.lin.substring(0, 2);
        const direccio = api.dir;
        const properes = parseProperesParades(api.properes_parades);
        const estacioActual = api.estacionat_a || (properes.length > 0 ? properes[0] : "");

        if (!liniesRequerides.includes(liniaApi)) {
            continue;
        }

        if (idToTrainMap.has(apiId)) {
            const trainData = idToTrainMap.get(apiId);
            trainData.proximaParada = properes.length > 0 ? properes[0] : null;
            trainData.coordinates = api.coordinates;
            trainData.tipus_unitat = api.tipus_unitat || 'Desconegut'; // Añadido aquí
            const trenNom = trainData.tren;
            const train = itineraryList.find(t => t.Tren === trenNom);
            if (!train || matchedTrains.has(trenNom)) continue;

            const itinerarioOrdenado = getOrderedItinerary(train);
            
            let coincideEnTiempoYSecuencia = false;
            
            for (const parada of itinerarioOrdenado) {
                const { estacio, hora } = parada;
                const horaEst = parseHora(hora);
                const diffMin = Math.abs((horaEst - horaActual) / 60000);

                if (diffMin <= 10 && (estacio === estacioActual || properes.includes(estacio))) {
                    if (estacio === estacioActual || verificarSecuenciaParadas(properes, itinerarioOrdenado, estacio)) {
                        coincideEnTiempoYSecuencia = true;
                        matches.push({
                            tren: trenNom,
                            linia: liniaApi,
                            direccio,
                            estacio: estacioActual,
                            hora: hora,
                            matched: true
                        });

                        matchedTrains.add(trenNom);
                        break;
                    }
                }
            }
            
            if (!coincideEnTiempoYSecuencia) {
                idToTrainMap.delete(apiId);
            } else {
                continue;
            }
        }

        let mejorMatch = null;
        let mejorPuntuacion = 0;
        let horaMatch = "";

        for (const train of itineraryList) {
            const liniaItinerary = train.Linia.substring(0, 2);
            if (liniaItinerary !== liniaApi || train["A/D"] !== direccio) continue;
            if (matchedTrains.has(train.Tren)) continue;

            const itinerarioOrdenado = getOrderedItinerary(train);
            
            for (let i = 0; i < itinerarioOrdenado.length; i++) {
                const { estacio, hora } = itinerarioOrdenado[i];
                const horaEst = parseHora(hora);
                const diffMin = Math.abs((horaEst - horaActual) / 60000);

                if (diffMin <= 10 && (estacio === estacioActual || properes.includes(estacio))) {
                    let puntuacion = 10 - diffMin;
                    
                    if (estacio === estacioActual) {
                        puntuacion += 5;
                    }
                    
                    if (verificarSecuenciaParadas(properes, itinerarioOrdenado, estacio)) {
                        puntuacion += 10;
                    }
                    
                    if (puntuacion > mejorPuntuacion) {
                        mejorMatch = {
                            tren: train.Tren,
                            linia: liniaItinerary,
                            direccio,
                            estacio: estacioActual,
                            hora: hora,
                            matched: true
                        };
                        mejorPuntuacion = puntuacion;
                        horaMatch = hora;
                    }
                }
            }
        }

        if (mejorMatch) {
            matches.push(mejorMatch);
            matchedTrains.add(mejorMatch.tren);
            idToTrainMap.set(apiId, {
                tren: mejorMatch.tren,
                coordinates: api.coordinates,
                proximaParada: properes.length > 0 ? properes[0] : null,
            en_hora: api.en_hora  // Afegim en_hora
            });
        }
    }

    return matches;
  }

  function updateMapMarkers() {
    markersLayer.clearLayers();
    let count = 0;
    
    idToTrainMap.forEach((trainData, id) => {
        const [lng, lat] = trainData.coordinates;
        if (lat && lng) {
            const trainInfo = itineraryList.find(t => t.Tren === trainData.tren);
            const flecha = trainInfo && trainInfo['A/D'] === "A" ? "🔼" : "🔽";
            
            // Obtener la hora de paso si existe la próxima parada
            let horaPaso = '';
            if (trainData.proximaParada && trainInfo) {
                horaPaso = trainInfo[trainData.proximaParada] || '';
            }

            let retardHTML = '';
            if (horaPaso) {
              const [h, m] = horaPaso.split(':').map(Number);
              const horaPrevista = new Date();
              horaPrevista.setHours(h, m, 0, 0);
              const ara = new Date();

              const diffMs = ara - horaPrevista;
              const diffMin = Math.round(diffMs / 60000);

              if (!isNaN(diffMin)) {
                if (diffMin >= 2) {
                  retardHTML = `<br><span class="label">Retard:</span> <span class="value" style="color:red;">+${diffMin} min</span>`;
                } else {
                  retardHTML = `<br><span class="label">A temps</span>`;
                }
              }
            }

            const proximaParada = trainData.proximaParada ? 
                `<div class="info-row">
                    <span class="label">Propera parada:</span> 
                    <span class="value">${trainData.proximaParada}</span>
                    ${horaPaso ? `<br><span class="label">Hora:</span> 
                    <span class="value">${horaPaso}</span>` : ''}
                    ${retardHTML}
                </div>` : '';

            // Añadir el campo tipus_unitat al popup
            const tipusUnitat = trainData.tipus_unitat || 'Desconegut';
    
            // Construir el texto del tooltip
            let tooltipText = `${flecha} ${trainData.tren}`;
            if (retardHTML && retardHTML.includes('Retard')) {
                // Extraer solo el texto de minutos de retraso
                const match = retardHTML.match(/\+(\d+) min/);
                if (match) {
                    tooltipText += ` <span style=\"color:red;\">(+${match[1]} min)</span>`;
                }
            }
    
            const marker = L.marker([lat, lng], {
                icon: trainIcon
            }).bindTooltip(tooltipText, {
                permanent: true,
                direction: 'top',
                offset: [4, -15],
                /*className: trainData.en_hora === true ? 'leaflet-tooltip tooltip-verde' : 'leaflet-tooltip tooltip-vermell'*/                className: getTooltipColor(trainData, trainInfo, retardHTML)
              }).bindPopup(`
                <div class="custom-popup">
                    <h3>🚆 <a href="#" onclick="showItinerary('${trainData.tren}'); return false;">Tren ${trainData.tren}</a></h3>
                    <div class="info-row">
                        <span class="label">Línea:</span>
                        <span class="value">${trainInfo ? trainInfo.Linia : 'N/A'}</span>
                    </div>                    ${proximaParada}                    <div class="info-row">
                        <span class="label">Tipus Unitat:</span>
                        <span class="value">${tipusUnitat}</span>
                    </div>
                    <div class="info-row">
                        <span class="label">Torn:</span>
                        <span class="value">${trainInfo ? trainInfo.Torn || '-' : '-'}</span>
                    </div>
                    ${getColorInfo(trainData.tren)}
                </div>
            `, {
                offset: L.point(4, 0)  // Desplaza el popup 20 píxeles hacia arriba
            });
            
            markersLayer.addLayer(marker);
            count++;
        }
    });
    
    document.getElementById("matchedCount").textContent = count;
  }

    function resetData() {
      itineraryList = [];
      idToTrainMap.clear();
      markersLayer.clearLayers();
      document.getElementById("matchedCount").textContent = "0";
  }

  // Funció asíncrona per carregar colors des de color_trens.json
async function loadTrainColorsFromFile() {
  try {
    const response = await fetch('./color_trens.json');
    if (!response.ok) throw new Error('No s\'ha pogut carregar color_trens.json');
    const imported = await response.json();
    trainColorMap = new Map();
    imported.forEach(item => {
      trainColorMap.set(item.tren, { color: item.color, reference: item.reference });
    });
    // Esborrar localStorage abans de guardar els nous colors
    localStorage.removeItem('trainColors');
    saveTrainColors();
  } catch (error) {
    console.error('Error carregant colors:', error);
  }
}

  async function refresh() {
    if (itineraryList.length === 0) {
        console.log("No hay itinerarios cargados");
        alert("Primero carga un archivo JSON con itinerarios");
        return;
    }

    try {
        // Esperar a que els colors estiguin carregats
        await loadTrainColorsFromFile();

        const horaActual = getHoraActual();
        const apiTrains = await fetchAllTrains();
        console.log("Trenes obtenidos de la API:", apiTrains.length);
        console.log("Estado actual de idToTrainMap:", idToTrainMap.size);

        // Limpiar trenes no activos
        const idsActuals = new Set(apiTrains.map(api => api.id));
        console.log("IDs de trenes activos:", Array.from(idsActuals));

        Array.from(idToTrainMap.keys()).forEach(id => {
            if (!idsActuals.has(id)) {
                console.log(`Eliminando tren inactivo con ID: ${id}`);
                idToTrainMap.delete(id);
            }
        });

        const matches = matchTrains(itineraryList, apiTrains, horaActual);
        console.log("Matches encontrados:", matches.length);
        console.log("Estado final de idToTrainMap:", idToTrainMap.size);
        console.log("Contenido de idToTrainMap:", Array.from(idToTrainMap.entries()));

        updateMapMarkers();
    } catch (error) {
        console.error('Error en refresh:', error);
    }
  }

  document.querySelectorAll('.controls__file-button').forEach(button => {
  button.addEventListener('click', async function() {
    const fileName = this.dataset.file;
    
    try {
      // Desactivar todos los botones
      document.querySelectorAll('.controls__file-button').forEach(btn => {
        btn.classList.remove('active');
      });
      
      // Activar el botón seleccionado
      this.classList.add('active');
      
      // Reiniciar los datos abans de carregar el nou arxiu
      resetData();
      
      const response = await fetch(fileName);
      if (!response.ok) {
        throw new Error(`Error al cargar el archivo: ${fileName}`);
      };
      
      const data = await response.json();
      itineraryList = data;
      alert(`Itinerario ${fileName} cargado correctamente.`);
      refresh();
    } catch (error) {
      alert(`Error al cargar el archivo ${fileName}: ${error.message}`);
      this.classList.remove('active');
    }
  });
});

  
function showItinerary(trainName) {
  const tren = itineraryList.find(t => t.Tren === trainName);
  if (!tren) return;

  document.getElementById("modalTrainName").textContent = trainName;

  const tableBody = document.getElementById("itineraryTable").querySelector("tbody");
  tableBody.innerHTML = "";

  // Utilizamos getOrderedItinerary para obtener las paradas ordenadas correctamente
  const itinerarioOrdenado = getOrderedItinerary(tren);
  // Añadimos cada parada a la tabla
  for (const parada of itinerarioOrdenado) {
    const row = `<tr><td>${parada.estacio}</td><td>${parada.hora}</td></tr>`;
    tableBody.innerHTML += row;
  }

  document.getElementById("itineraryModal").style.display = "block";
}

 
// Funció per determinar el color del tooltip
function getTooltipColor(trainData, trainInfo, retardHTML) {
    const selector = document.getElementById('trainColorSelector').value;
    
    if (selector === 'custom') {
        const colorData = trainColorMap.get(trainData.tren);
        return colorData ? colorData.color : 'leaflet-tooltip';
    }
    
    // Per defecte: segons retard
    return (trainData.en_hora === true || (retardHTML.includes('+') && parseInt(retardHTML.match(/\+(\d+)/)?.[1]) <= 2)) 
        ? 'leaflet-tooltip tooltip-verde' 
        : 'leaflet-tooltip tooltip-vermell';
}

// Funció per assignar color personalitzat a un tren
function assignTrainColor() {
    const trainName = document.getElementById('trainNameInput').value.trim();
    const colorRef = document.getElementById('colorRefInput').value.trim();
    const color = document.getElementById('colorSelect').value;
    
    if (!trainName) {
        alert('Introdueix un nom de tren');
        return;
    }
    
    if (!colorRef) {
        alert('Introdueix una referència per al color');
        return;
    }
    
    trainColorMap.set(trainName, { color, reference: colorRef });
    saveTrainColors(); // Guardar colors al localStorage
    
    document.getElementById('trainNameInput').value = '';
    document.getElementById('colorRefInput').value = '';
    
    // Actualitzar marcadors si hi ha trens carregats
    if (idToTrainMap.size > 0) {
        updateMapMarkers();
    }
    
    alert(`Color ${color.replace('tooltip-', '')} assignat al tren ${trainName} (${colorRef})`);
}

// Funció per esborrar tots els colors personalitzats
function clearTrainColors() {
    trainColorMap.clear();
    localStorage.removeItem('trainColors'); // Esborrar colors del localStorage
    if (idToTrainMap.size > 0) {
        updateMapMarkers();
    }
    alert('Colors personalitzats esborrats');
}

// Event listener per al selector de color
document.addEventListener('DOMContentLoaded', async function() {
    // Primer intentar carregar colors des de fitxer
    await loadTrainColorsFromFile();
    // Si no hi ha colors, carregar del localStorage (per compatibilitat)
    if (trainColorMap.size === 0) {
      loadTrainColors();
    }
    const selector = document.getElementById('trainColorSelector');
    const customControls = document.getElementById('customColorControls');
    
    // Si hi ha colors personalitzats guardats, activar el mode personalitzat
    if (trainColorMap.size > 0) {
        selector.value = 'custom';
        customControls.style.display = 'block';
    }
    
    selector.addEventListener('change', function() {
        if (this.value === 'custom') {
            customControls.style.display = 'block';
        } else {
            customControls.style.display = 'none';
        }
        
        // Actualitzar marcadors
        if (idToTrainMap.size > 0) {
            updateMapMarkers();
        }
    });
});

// Control del selector de colores
document.addEventListener('DOMContentLoaded', function() {
    const colorSelectorToggle = document.getElementById('colorSelectorToggle');
    const colorSelectorContent = document.getElementById('colorSelectorContent');
    
    // Toggle del panel de colores
    colorSelectorToggle.addEventListener('click', function() {
        colorSelectorContent.classList.toggle('active');
        colorSelectorToggle.textContent = colorSelectorContent.classList.contains('active') ? '−' : '+';
    });
    
    // Cerrar el panel si se hace clic fuera
    document.addEventListener('click', function(event) {
        if (!event.target.closest('.color-selector')) {
            colorSelectorContent.classList.remove('active');
            colorSelectorToggle.textContent = '+';
        }
    });
});



// Inicializar el mapa al cargar
initMap();
setInterval(refresh, 10000);
setInterval(refreshColors, 20000); // Refresca colors cada 20 segons

// Función para generar el HTML del color asignado
function getColorInfo(trainName) {
    const colorData = trainColorMap.get(trainName);
    if (!colorData) return '';
    
    return `
    <div class="info-row">
        <span class="label">Color assignat:</span>
        <div class="color-info">
            <span class="color-ball ${colorData.color}"></span>
            <span class="value">${colorData.reference}</span>
        </div>
    </div>`;
}

// Función para exportar los colores personalizados a un archivo JSON
function exportTrainColors() {
  const colors = {};
  trainColorMap.forEach((value, key) => {
    colors[key] = value;
  });
  const blob = new Blob([JSON.stringify(colors, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'colores_trenes.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Función para importar colores personalizados desde un archivo JSON
function importTrainColors() {
  fetch('./color_trens.json')
    .then(response => {
      if (!response.ok) throw new Error('No s\'ha pogut carregar color_trens.json');
      return response.json();
    })
    .then(imported => {
      trainColorMap = new Map();
      imported.forEach(item => {
        trainColorMap.set(item.tren, { color: item.color, reference: item.reference });
      });
      saveTrainColors();
      if (idToTrainMap.size > 0) {
        updateMapMarkers();
      }
      alert('Colors importats correctament!');
    })
    .catch((error) => {
      console.error('Error al importar colors:', error);
      alert('Error al importar el fitxer de colors. Comprova que el fitxer color_trens.json existeix al repositori.');
    });
}

// Funció per refrescar els colors des de color_trens.json
function refreshColors() {
  fetch('./color_trens.json')
    .then(response => {
      if (!response.ok) throw new Error('No s\'ha pogut carregar color_trens.json');
      return response.json();
    })
    .then(imported => {
      trainColorMap = new Map();
      imported.forEach(item => {
        trainColorMap.set(item.tren, { color: item.color, reference: item.reference });
      });
      saveTrainColors();
      if (typeof updateMapMarkers === 'function' && idToTrainMap && idToTrainMap.size > 0) {
        updateMapMarkers();
      }
      // Opcional: console.log('Colors refrescats correctament!');
    })
    .catch((error) => {
      console.error('Error al refrescar colors:', error);
    });
}

# SolarEdge (Modbus)

Diese Integration verbindet Gladys **lokal** über Modbus TCP mit Ihrer
SolarEdge-Anlage: kein SolarEdge-Konto, keine Cloud, kein API-Schlüssel und alle
paar Sekunden ein Messwert statt alle 15 Minuten.

## Was Sie erhalten

Die Integration erkennt alles, was hinter Ihrem Wechselrichter antwortet:

| Gerät                      | Funktionen                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Wechselrichter** (jeder) | Solarerzeugung (W), Gesamterzeugung (kWh), AC-Spannung, AC-Strom, Kühlkörpertemperatur, Status                                 |
| **Netzzähler**             | Netzleistung (W, Bezug > 0, Einspeisung < 0), Bezugszählerstand (kWh), Einspeisezählerstand (kWh), Hausverbrauch (W)           |
| **Verbrauchszähler**       | Hausverbrauch (W), Verbrauchszählerstand (kWh)                                                                                 |
| **Batterie** (StorEdge)    | Ladestand (%), Lade- und Entladeleistung (W), geladene / entladene Energie (kWh), verfügbare Energie (kWh), Temperatur, Status |

Der Hausverbrauch wird aus der Erzeugung der Wechselrichter und dem
Netzaustausch berechnet. Die Zählerstände speisen das Energie-Dashboard von
Gladys.

## Vorbereitung: Modbus TCP aktivieren

1. Öffnen Sie die **SetApp** am Wechselrichter (oder das LCD-Menü älterer
   Geräte): **Inbetriebnahme → Standortkommunikation → Modbus TCP → Aktivieren**.
2. Notieren Sie den **Port**: standardmäßig 1502 bei SetApp-Geräten, oft 502 bei
   älteren.
3. Geben Sie dem Wechselrichter eine **feste IP-Adresse** im Router
   (DHCP-Reservierung).
4. Modbus TCP funktioniert über den **Ethernet**-Anschluss. Über WLAN hängt es
   von Modell und Firmware ab.

> Der Wechselrichter akzeptiert **nur einen Modbus-TCP-Client gleichzeitig**.
> Liest bereits ein anderes System (Home Assistant, ein Energiemanager…) über
> Modbus, beenden Sie es, sonst verdrängen sich beide gegenseitig.

## Konfiguration

| Feld                                   | Beschreibung                                                                                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| IP-Adresse des Wechselrichters         | Die Adresse des Wechselrichters (bei mehreren der Leader).                                                                            |
| Modbus-TCP-Port                        | Standardmäßig 1502.                                                                                                                   |
| Modbus-Unit-IDs                        | `1` für einen einzelnen Wechselrichter. Leader/Follower: die ID jedes Wechselrichters, durch Kommas getrennt (z. B. `1,2`).           |
| Aktualisierungsintervall               | Sekunden zwischen zwei Abfragen (5 bis 300, standardmäßig 10). Große Anlagen werden automatisch langsamer abgefragt.                  |
| Schwelle für Solarüberschuss           | Netzeinspeisung (W), ab der der Auslöser _Solarüberschuss_ auslöst (standardmäßig 500 W).                                             |
| Richtung des Netzzählers umkehren      | Aktivieren, wenn Gladys Bezug anzeigt, während Sie einspeisen.                                                                        |
| Steuerung des Wechselrichters erlauben | Standardmäßig aus: die Integration liest nur. Aktivieren, damit Szenen und Widgets die Erzeugung begrenzen oder die Batterie steuern. |

Speichern Sie und klicken Sie auf **Verbindung testen**: die Integration listet
die gefundenen Geräte auf, die im Tab **Erkennung** erscheinen und hinzugefügt
werden können.

## Szenen

### Auslöser

- **Wechselrichterstatus geändert** — produziert, begrenzt, Ruhezustand (Nacht),
  Fehler… Filter auf Wechselrichter und neuen Status. Variablen: `status`,
  `previous_status`, `power`.
- **Solarüberschuss** — die Einspeisung überschreitet die Schwelle (`started`)
  oder fällt unter deren Hälfte (`ended`). Ideal für Warmwasserbereiter,
  Poolpumpe oder E-Auto-Ladung. Variablen: `state`, `export_power`.
- **Batteriestatus geändert** — lädt, entlädt, Leerlauf, Fehler… Variablen:
  `status`, `previous_status`, `level`.
- **Verbindung zum Wechselrichter verloren oder wiederhergestellt** — nach 3
  fehlgeschlagenen Abfragen in Folge. Variablen: `state`, `message`.

Der Standard-Auslöser „Gerätezustand“ von Gladys funktioniert ebenfalls auf jeder
Funktion (z. B. _Batteriestand über 90 %_, _Erzeugung über 2000 W_).

### Aktionen

- **Solaranlage auslesen** — liefert Erzeugung, Verbrauch, Netzleistung,
  Batteriestand, heutige Erzeugung und Wechselrichterstatus an die folgenden
  Aktionen.
- **Solarerzeugung begrenzen** — Wirkleistungsbegrenzung in % der Nennleistung,
  z. B. bei negativen Strompreisen. 100 hebt sie auf. _Die Grenze bleibt im
  Wechselrichter gespeichert, bis sie geändert wird._
- **Batteriemodus einstellen** — Eigenverbrauch maximieren, zeitgesteuert, nur
  Notstrom, Fernsteuerung.
- **Batterie laden oder entladen** — ein Fernbefehl (aus Solar und Netz laden,
  zur Hausversorgung entladen, halten…) für eine bestimmte Dauer, mit optionaler
  Leistungsgrenze. Danach kehrt der Wechselrichter in seinen Standardmodus zurück.
- **Notstromreserve einstellen** — Anteil der Batterie, der für Stromausfälle
  reserviert bleibt.

Die Steueraktionen erfordern **Steuerung des Wechselrichters erlauben** in der
Konfiguration. Andernfalls liefern sie `applied = false`, ohne den
Wechselrichter zu verändern. Batteriebefehle erfordern einen
StorEdge-Wechselrichter; das Laden aus dem Netz kann zusätzlich die vom
Installateur freigegebene AC-Ladung erfordern.

## Dashboard

- **Solarerzeugung** — Erzeugung, Verbrauch, Netzaustausch und Batteriestand
  live, ein Erzeugungsdiagramm (Zeitraum einstellbar), die heutige Erzeugung,
  der Wechselrichterstatus und Ihre Autarkie.
- **Solarbatterie** — Ladestand, Lade- und Entladeleistung, verfügbare Energie,
  Status, Zustand, Modus und Notstromreserve. Ist die Steuerung erlaubt, schalten
  zwei Schaltflächen die Batterie auf Eigenverbrauch oder nur Notstrom.

## Schaltflächen der Konfiguration

- **Verbindung testen** — erkennt die Anlage und aktualisiert die Geräte.
- **Leistungsbegrenzung aufheben** — setzt jeden Wechselrichter auf 100 % zurück.

## Fehlerbehebung

- **„Nicht erreichbar…“**: IP-Adresse und Port prüfen, Modbus TCP aktiviert,
  kein anderer Modbus-Client verbunden.
- **Exception 11 / keine Antwort auf einer Unit-ID**: falsche ID. Ein einzelner
  Wechselrichter verwendet `1`.
- **Netzleistung mit falschem Vorzeichen**: _Richtung des Netzzählers umkehren_
  aktivieren.
- **Die heutige Erzeugung** beginnt mit der ersten Abfrage des Tages (Ortszeit
  der Integration) und übersteht Neustarts.
- Nachts antworten die meisten Wechselrichter im _Ruhezustand_; manche gar nicht:
  die Geräte bleiben in Gladys und kommen bei Sonnenaufgang zurück.
- Logs: Öffnen Sie die Logs der Integration in Gladys. `LOG_LEVEL=debug` zeigt
  alle Details.

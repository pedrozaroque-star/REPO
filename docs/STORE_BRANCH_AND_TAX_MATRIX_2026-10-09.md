/**
 * @module STORE_BRANCH_AND_TAX_MATRIX_2026-10-09
 * @description Matriz oficial de las 15 sucursales de Tacos Gavilan: identificadores de base de datos,
 * Toast Restaurant External IDs, tasas impositivas oficiales CDTFA, coordenadas geográficas,
 * opciones de entrega y radio de cobertura para delivery.
 * @businessRules
 * 1. Cada sucursal tiene su propia tasa municipal de ventas (CDTFA) vigente al 1 de octubre de 2026.
 * 2. Los External IDs de Toast corresponden a las instancias de restaurante activas en Toast POS.
 * 3. El radio de cobertura para entrega a domicilio está fijado en 5.0 millas náuticas/terrestres.
 */

# 🏬 MATRIZ OFICIAL DE SUCURSALES, TOAST IDS Y TASAS CDTFA
**Empresa:** Tacos Gavilan  
**Fecha de Vigencia:** 9 de octubre de 2026  
**Zona Horaria:** `America/Los_Angeles`  
**Radio de Entrega Estándar:** 5.0 Millas  

---

## 1. Tabla Maestra de las 15 Sucursales Activas

| ID | Sucursal | Ciudad | Dirección Oficial | Toast Restaurant External ID | Tasa CDTFA (Oct 2026) | Coordenadas (Lat, Lng) | Opciones de Retiro (Pickup) | Cobertura Delivery |
| :---: | :--- | :--- | :--- | :--- | :---: | :---: | :--- | :---: |
| **1** | **Rialto** | Rialto | 115 E. Baseline Rd. | `acf15327-54c8-4da4-8d0d-3ac0544dc422` | **7.75%** | 34.121100, -117.370048 | In-Store / Curbside | 5.0 millas |
| **3** | **West Covina** | West Covina | 101 S. Azusa Ave. | `5f4a006e-9a6e-4bcf-b5bd-7f5e9d801a02` | **10.25%** | 34.070966, -117.908150 | In-Store / Curbside | 5.0 millas |
| **4** | **Azusa** | Azusa | 887 S. Azusa Ave. | `e0345b1f-d6d6-40b2-bd06-5f9f4fd944e8` | **11.25%** | 34.107074, -117.908194 | In-Store / Curbside | 5.0 millas |
| **5** | **LA Broadway** | Los Angeles | 4380 S. Broadway | `475bc112-187d-4b9c-884d-1f6a041698ce` | **10.25%** | 34.004005, -118.278106 | In-Store / Curbside | 5.0 millas |
| **6** | **LA Central** | Los Angeles | 1900 S. Central Ave. | `8685e942-3f07-403a-afb6-faec697cd2cb` | **10.25%** | 34.023884, -118.250561 | In-Store / Curbside | 5.0 millas |
| **7** | **Slauson** | Los Angeles | 5833 South Broadway LA | `9625621e-1b5e-48d7-87ae-7094fab5a4fd` | **10.25%** | 33.988940, -118.278609 | In-Store / Curbside | 5.0 millas |
| **8** | **Hollywood** | Los Angeles | 7070 Sunset Blvd. | `5fbb58f5-283c-4ea4-9415-04100ee6978b` | **10.25%** | 34.097757, -118.343890 | In-Store / Curbside | 5.0 millas |
| **9** | **Santa Ana** | Santa Ana | 1258 E. 17th St. | `3c2d8251-c43c-43b8-8306-387e0a4ed7c2` | **9.25%** | 33.759621, -117.852252 | In-Store / Curbside | 5.0 millas |
| **10** | **La Puente** | La Puente | 13009 Valley Blvd. | `3a803939-eb13-4def-a1a4-462df8e90623` | **10.75%** | 34.053251, -118.001777 | In-Store / Curbside | 5.0 millas |
| **11** | **Huntington Park** | Huntington Park | 2425 E. Florence Ave. | `47256ade-2cd4-4073-9632-84567ad9e2c8` | **11.00%** | 33.975055, -118.229235 | In-Store / Curbside | 5.0 millas |
| **12** | **Norwalk** | Norwalk | 10968 Rosecrans Ave. | `42ed15a6-106b-466a-9076-1e8f72451f6b` | **11.00%** | 33.901810, -118.100403 | In-Store / Curbside | 5.0 millas |
| **13** | **Bell** | Bell | 4406 E. Florence Ave. | `a83901db-2431-4283-834e-9502a2ba4b3b` | **10.25%** | 33.970395, -118.188871 | In-Store / Curbside | 5.0 millas |
| **14** | **Lynwood (Piloto)** | Lynwood | 3220 E. Imperial Hwy. | `80a1ec95-bc73-402e-8884-e5abbe9343e6` | **11.25%** | 33.930001, -118.212320 | In-Store / Curbside | 5.0 millas |
| **15** | **South Gate** | South Gate | 5800 Firestone Blvd. | `95866cfc-eeb8-4af9-9586-f78931e1ea04` | **11.25%** | 33.948795, -118.164767 | In-Store / Curbside | 5.0 millas |
| **16** | **Downey** | Downey | 7947 E. Florence Ave. | `b7f63b01-f089-4ad7-a346-afdb1803dc1a` | **11.00%** | 33.953703, -118.130299 | In-Store / Curbside | 5.0 millas |

---

## 2. Reglas de Dining Options en Toast POS

1. **Resolución Dinámica de Dining Options**:
   - Cada tienda posee sus propios identificadores únicos (GUIDs) para modalidades de servicio en Toast.
   - La función `getDiningOptionsMap(externalId)` consulta el endpoint `/config/v2/diningOptions` para traducir los identificadores de Toast hacia los comportamientos nativos de la aplicación:
     * `behavior: "TAKE_OUT"` -> Mapea a **Pickup en Mostrador (In-Store)**.
     * `behavior: "CURBSIDE"` -> Mapea a **Pickup en Auto (Curbside Hold & Fire)**.
     * `behavior: "DELIVERY"` -> Mapea a **Entrega a Domicilio (Delivery)**.
2. **Cálculo de Distancia**:
   - Para entregas a domicilio, el backend evalúa la distancia ortodrómica mediante la fórmula de Haversine contra las coordenadas oficiales de la tienda seleccionada.
   - Si la distancia calculada excede `5.0 millas`, el backend rechaza la cotización con el código `OUT_OF_DELIVERY_RANGE`.

# SolarEdge (Modbus)

Esta integración conecta Gladys con su instalación SolarEdge **en local**, por
Modbus TCP: sin cuenta SolarEdge, sin nube, sin clave de API, y una lectura cada
pocos segundos en lugar de cada 15 minutos.

## Qué obtiene

La integración detecta todo lo que responde detrás de su inversor:

| Dispositivo             | Funciones                                                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Inversor** (cada uno) | Producción solar (W), producción total (kWh), tensión AC, corriente AC, temperatura del disipador, estado                               |
| **Contador de red**     | Potencia de red (W, consumo > 0, inyección < 0), índice de consumo de red (kWh), índice de inyección (kWh), consumo de la casa (W)      |
| **Contador de consumo** | Consumo de la casa (W), índice de consumo (kWh)                                                                                         |
| **Batería** (StorEdge)  | Nivel de carga (%), potencia de carga y descarga (W), energía cargada / descargada (kWh), energía disponible (kWh), temperatura, estado |

El consumo de la casa se calcula a partir de la producción de los inversores y
del intercambio con la red. Los índices alimentan el panel de energía de Gladys.

## Antes de empezar: activar Modbus TCP

1. Abra la aplicación **SetApp** junto al inversor (o el menú LCD en los
   inversores antiguos): **Puesta en marcha → Comunicación del sitio → Modbus
   TCP → Activar**.
2. Anote el **puerto**: 1502 por defecto en los inversores SetApp, a menudo 502
   en los antiguos.
3. Asigne una **dirección IP fija** al inversor en su router (reserva DHCP).
4. Modbus TCP funciona por el puerto **Ethernet** del inversor. Por Wi-Fi depende
   del modelo y del firmware.

> El inversor solo acepta **un cliente Modbus TCP a la vez**. Si otro sistema
> (Home Assistant, un gestor de energía…) ya lo lee por Modbus, deténgalo o se
> desconectarán mutuamente.

## Configuración

| Campo                            | Descripción                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Dirección IP del inversor        | La dirección del inversor (el maestro si hay varios).                                                                               |
| Puerto Modbus TCP                | 1502 por defecto.                                                                                                                   |
| Identificadores Modbus (unit id) | `1` para un solo inversor. Instalaciones maestro/esclavo: el identificador de cada inversor, separados por comas (p. ej. `1,2`).    |
| Intervalo de actualización       | Segundos entre dos lecturas (5 a 300, 10 por defecto). Las instalaciones grandes se ralentizan automáticamente.                     |
| Umbral de excedente solar        | Inyección a la red (W) a partir de la cual se dispara el activador _Excedente solar_ (500 W por defecto).                           |
| Invertir el sentido del contador | Actívelo si Gladys muestra consumo de red cuando usted inyecta.                                                                     |
| Permitir el control del inversor | Desactivado por defecto: la integración solo lee. Actívelo para que escenas y widgets limiten la producción o controlen la batería. |

Guarde y pulse **Probar la conexión**: la integración muestra lo que ha
encontrado y los dispositivos aparecen en la pestaña **Descubrimiento**, listos
para añadirse.

## Escenas

### Activadores

- **Estado del inversor cambiado** — produciendo, limitado, en reposo (noche),
  fallo… Filtre por inversor y nuevo estado. Variables: `status`,
  `previous_status`, `power`.
- **Excedente solar** — la inyección a la red supera el umbral (`started`) o
  vuelve por debajo de su mitad (`ended`). Ideal para arrancar un termo, una
  bomba de piscina o la carga de un coche eléctrico. Variables: `state`,
  `export_power`.
- **Estado de la batería cambiado** — cargando, descargando, inactiva, fallo…
  Variables: `status`, `previous_status`, `level`.
- **Conexión con el inversor perdida o restablecida** — tras 3 lecturas fallidas
  seguidas. Variables: `state`, `message`.

El activador estándar de Gladys «estado de un dispositivo» también funciona en
cada función (p. ej. _nivel de batería por encima del 90 %_, _producción por
encima de 2000 W_).

### Acciones

- **Leer la instalación solar** — devuelve producción, consumo, potencia de red,
  nivel de batería, producción de hoy y estado del inversor a las acciones
  siguientes.
- **Limitar la producción solar** — límite de potencia activa en % de la
  potencia nominal, por ejemplo con precios negativos. 100 lo quita. _El límite
  queda guardado en el inversor hasta que se cambie._
- **Cambiar el modo de la batería** — maximizar el autoconsumo, según horario,
  solo respaldo, control remoto.
- **Cargar o descargar la batería** — una orden remota (cargar desde solar y red,
  descargar para cubrir la casa, mantener…) durante un tiempo dado, con un límite
  de potencia opcional. Después el inversor vuelve a su modo por defecto.
- **Ajustar la reserva de respaldo** — parte de la batería reservada para cortes
  de luz.

Las acciones de control requieren **Permitir el control del inversor** en la
configuración. Si no, devuelven `applied = false` sin tocar el inversor. Las
órdenes de batería requieren un inversor StorEdge; la carga desde la red también
puede requerir que su instalador haya autorizado la carga AC.

## Panel

- **Producción solar** — producción, consumo, intercambio con la red y nivel de
  batería en directo, un gráfico de producción (periodo configurable), la
  producción de hoy, el estado del inversor y su autosuficiencia.
- **Batería solar** — nivel de carga, potencia de carga y descarga, energía
  disponible, estado, salud, modo y reserva de respaldo. Si el control está
  permitido, dos botones pasan la batería a autoconsumo o a solo respaldo.

## Botones de la pantalla de configuración

- **Probar la conexión** — detecta la instalación y actualiza los dispositivos.
- **Quitar el límite de producción** — vuelve a poner cada inversor al 100 %.

## Resolución de problemas

- **«No se puede acceder…»**: compruebe la IP y el puerto, que Modbus TCP está
  activado y que ningún otro cliente Modbus está conectado.
- **Excepción 11 / sin respuesta en un unit id**: el identificador es incorrecto.
  Un inversor solo usa `1`.
- **Potencia de red con el signo equivocado**: active _Invertir el sentido del
  contador de red_.
- **La producción de hoy** empieza con la primera lectura del día (hora local de
  la integración) y sobrevive a los reinicios.
- De noche la mayoría de inversores responden en modo _reposo_; algunos dejan de
  responder: los dispositivos permanecen en Gladys y vuelven al amanecer.
- Registros: abra los registros de la integración en Gladys. `LOG_LEVEL=debug`
  muestra todos los detalles.

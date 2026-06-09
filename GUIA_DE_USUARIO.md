# 📖 GUÍA DE USUARIO - VALHALLA
## Sistema de Gestión para Barberías

**¡Bienvenido a VALHALLA!** Esta es tu guía paso a paso para usar el sistema de gestión de tu barbería.

---

## 🔑 ACCESO AL SISTEMA

### Primer Login
1. Abre tu navegador y ve a: `https://tu-dominio.com` (o `localhost:3000` en desarrollo)
2. Verás la pantalla de **LOGIN**
3. Ingresa tu email y contraseña
4. Haz click en **"Ingresar"**

![Login Screen]

### Si Olvidaste tu Contraseña
- En la pantalla de login, busca el link **"¿Olvidaste tu contraseña?"**
- Recibirás un email con instrucciones para restablecerla

---

## 🏢 SELECCIÓN DE SUCURSAL

Después de login, verás una pantalla con tus sucursales disponibles.

**¿Qué hacer?**
1. Haz click en la sucursal donde deseas trabajar
2. ¡Listo! Entrarás al panel de administración

> 💡 **Tip:** Si perteneces a múltiples sucursales, podrás cambiar entre ellas desde el menú lateral (arriba a la izquierda, opción "Volver al panel")

---

## 🏠 PANEL PRINCIPAL (DASHBOARD)

### Vista General
El panel principal tiene un **menú lateral izquierdo** con estas opciones:

```
📊 Dashboard (lo que ves ahora)
👨‍💼 Barberos
👤 Administradores
✂️ Servicios
📅 Semanas
🎁 Beneficios
⚙️ Configuración
📈 Reportes
🔍 Auditoría
```

Cada opción abre una sección específica del sistema.

---

## 💰 REGISTRO DE TRANSACCIONES (Pestaña "En Vivo")

### ¿Qué es?
Es el registro diario de todas las ventas y servicios realizados.

### Cómo Agregar una Transacción
1. Haz click en el botón **"+ Nueva Transacción"** (arriba)
2. Completa los datos:
   - **Barbero:** Selecciona quién realizó el servicio
   - **Monto:** Ingresa el valor (ej: 500)
   - **Método de Pago:** Efectivo, Tarjeta, Transferencia, etc.
   - **Descripción:** Opcional (ej: Corte + Barba)
3. Haz click en **"Guardar"**

### Editar una Transacción
1. Haz doble-click en el valor que deseas editar
2. Modifica el valor
3. Presiona **Enter** para guardar

### Cambiar el Estado
- **Confirmada** (✓): Transacción validada y lista para liquidar
- **Pendiente** (⏳): En espera de confirmación
- **Anulada** (✗): Se descarta del cálculo

### Filtros Útiles
En la barra superior encontrarás filtros para:
- Filtrar por barbero específico
- Filtrar por método de pago
- Filtrar por estado (confirmada, pendiente, anulada)
- Búsqueda por fecha

---

## 💸 LIQUIDACIONES (Pestaña "Liquidaciones")

### ¿Qué es?
Es el cálculo de cuánto debe recibir cada barbero por sus comisiones.

### Estados de una Liquidación
1. **Pendiente** (🔵): En espera de revisión
2. **Confirmada** (🟢): Revisada y lista para pagar
3. **Pagada** (🟡): Ya se entregó el dinero al barbero

### Cómo Procesar una Liquidación
1. Ve a la pestaña **"Liquidaciones"**
2. Verás una tabla con todas las liquidaciones por semana y barbero
3. Revisa los montos calculados
4. Si está correcto, haz click en **"Confirmar"**
5. Cuando pagues, haz click en **"Marcar como Pagada"**

### ¿Cómo se Calcula la Comisión?
```
Monto Total de Servicios × Porcentaje de Comisión del Barbero
Ejemplo: $1000 × 20% = $200 de comisión
```

Si el barbero tiene **bonus por presentismo**, se suma:
```
$200 × (1 + 5% presentismo) = $210
```

---

## 👨‍💼 ADMINISTRACIÓN DE BARBEROS

### Ver la Lista de Barberos
1. Haz click en **"Barberos"** en el menú lateral
2. Verás todos los barberos (activos e inactivos)

### Agregar un Nuevo Barbero
1. Haz click en **"+ Nuevo Barbero"**
2. Completa:
   - **Nombre Completo**
   - **Email** (para notificaciones)
   - **Teléfono**
   - **Porcentaje de Comisión** (ej: 20%)
   - **Objetivo Mensual** (meta de ventas en $)
3. Haz click en **"Guardar"**

### Editar Información de un Barbero
1. Haz click en la fila del barbero
2. Modifica los campos necesarios
3. Guarda los cambios

### Desactivar un Barbero
1. Si el barbero ya no trabaja, marca **"Inactivo"**
2. Los barberos inactivos NO aparecerán en nuevas transacciones
3. Pero mantienen su histórico de comisiones

### Configurar Comisión por Barbero
- Cada barbero puede tener un **porcentaje diferente**
- Se configura en el campo **"Comisión (%)"**
- Se aplica automáticamente en liquidaciones

---

## ✂️ SERVICIOS Y CATÁLOGO

### Ver Servicios Disponibles
1. Haz click en **"Servicios"** en el menú
2. Verás la lista de servicios que ofreces

### Agregar un Nuevo Servicio
1. Haz click en **"+ Nuevo Servicio"**
2. Ingresa:
   - **Nombre del Servicio** (ej: Corte Hombre)
   - **Precio Base** (ej: 300)
   - **Descripción** (opcional)
3. Guardar

### Modificar Precio de un Servicio
1. Haz doble-click en el precio
2. Ingresa el nuevo valor
3. Presiona Enter

---

## 📅 SEMANAS DE TRABAJO

### ¿Qué es?
Una "semana" es el período de cálculo de comisiones (puede no ser una semana calendario).

### Ver Semanas
1. Haz click en **"Semanas"** 
2. Verás el calendario de períodos de liquidación

### Crear una Nueva Semana
1. Haz click en **"+ Nueva Semana"**
2. Selecciona:
   - **Fecha de Inicio**
   - **Fecha de Cierre**
3. Guardar

### Cerrar una Semana
1. Cuando la semana termine, haz click en **"Cerrar Semana"**
2. El sistema calculará automáticamente todas las comisiones
3. Una semana cerrada NO se puede editar

---

## 🎁 BENEFICIOS Y BONOS

### Tipos de Bonos
1. **Bonus de Presentismo**: Porcentaje extra por asistencia
   - Ej: 5% extra si asistió todos los días
   
2. **Bonus de Objetivo**: Porcentaje extra si cumplió meta
   - Ej: 10% extra si vendió más del objetivo mensual

### Asignar Bonos a un Barbero
1. Haz click en **"Beneficios"**
2. Selecciona el barbero
3. Ingresa el porcentaje de cada tipo de bonus
4. Guarda

### Aplicar Bonus Manual
Si necesitas dar un bonus especial:
1. Ve a **"Liquidaciones"**
2. Edita la liquidación del barbero
3. Agrega un monto extra
4. Confirma

---

## 📊 GASTOS E EGRESOS

### Registrar un Gasto
1. En el dashboard, busca la pestaña **"Gastos"**
2. Haz click en **"+ Nuevo Gasto"**
3. Completa:
   - **Categoría** (Alquiler, Servicios, Suministros, Otros)
   - **Monto**
   - **Descripción** (ej: Pago de alquiler agosto)
4. Guardar

### Ver Gastos por Categoría
1. En **"Gastos"**, verás un resumen por tipo
2. Ejemplo:
   - Alquiler: $5,000
   - Servicios: $1,500
   - Suministros: $800

### Categorías Disponibles
- **Alquiler**: Pago del local
- **Servicios**: Internet, Teléfono, Agua, Luz
- **Suministros**: Productos, Toallas, Detergentes
- **Otros**: Cualquier otro gasto

---

## 💵 ADELANTOS A BARBEROS

### ¿Qué es?
Un adelanto es dinero que le das a un barbero ANTES de que llegue su día de liquidación.

### Registrar un Adelanto
1. Haz click en **"Adelantos"** (pestaña en dashboard)
2. Haz click en **"+ Nuevo Adelanto"**
3. Selecciona:
   - **Barbero**
   - **Monto**
4. Guardar

### Cómo Funciona
- El adelanto se **descuenta automáticamente** de la liquidación del barbero
- Ejemplo:
  - Comisión ganada: $500
  - Adelanto anterior: -$200
  - A Recibir: $300

---

## 📈 REPORTES

### Generar un Reporte
1. Haz click en **"Reportes"** en el menú
2. Selecciona el tipo de reporte:
   - **Reporte Financiero**: Ingresos vs Gastos
   - **Por Barbero**: Vendedor específico
   - **Mensual**: Período completo

3. Selecciona el **período** (mes/semana)
4. Haz click en **"Generar"**

### Elementos del Reporte
- **Ingresos Totales**: Suma de todas las transacciones
- **Gastos**: Suma de todos los egresos
- **Comisiones Pagadas**: Total de liquidaciones
- **Balance Neto**: Ingresos - Gastos - Comisiones

### Descargar/Imprimir
- Al final del reporte, verás opción para:
  - Descargar PDF
  - Copiar datos
  - Imprimir

---

## 🔍 AUDITORÍA (Registro de Cambios)

### ¿Qué es?
Un registro de TODO lo que ha sido modificado en el sistema.

### Acceder a Auditoría
1. Haz click en **"Auditoría"** en el menú
2. Verás un registro completo con:
   - **Quién hizo el cambio** (usuario)
   - **Qué cambió** (campo modificado)
   - **Cuándo** (fecha y hora)
   - **Valores anteriores y nuevos**

### Filtros Útiles
- Filtrar por usuario
- Filtrar por tipo (transacción, barbero, gasto, etc.)
- Filtrar por fecha

---

## ⚙️ CONFIGURACIÓN

### Acceder a Configuración
1. Haz click en **"Configuración"** en el menú

### Qué Puedes Configurar
- **Nombre de la Sucursal**
- **Dirección y Contacto**
- **Métodos de Pago** disponibles
- **Horarios de Atención**
- **Datos Fiscales** (opcional)

---

## 👥 ADMINISTRACIÓN DE USUARIOS ADMIN

### Ver Administradores
1. Haz click en **"Administradores"**
2. Verás lista de usuarios con acceso al sistema

### Agregar un Nuevo Admin
1. Haz click en **"+ Nuevo Administrador"**
2. Ingresa:
   - **Email** del nuevo usuario
   - **Nombre**
3. Se enviará email de invitación
4. El usuario creará su contraseña

### Permisos
- Cada admin puede tener acceso a una o múltiples sucursales
- El admin que configures verá solo sus sucursales asignadas

---

## 🎓 CASOS DE USO COMUNES

### Caso 1: Es Lunes - Abrir la Semana
1. Abre **Dashboard**
2. Ve a pestaña **"Liquidaciones"** 
3. Verifica que semana anterior esté cerrada
4. Ve a **"Semanas"**
5. Crea nueva semana (lunes a domingo)
6. ¡Listo! Registra transacciones normally

### Caso 2: Es Viernes - Cerrar la Semana
1. Ve a **"Semanas"**
2. Busca la semana actual
3. Haz click en **"Cerrar Semana"**
4. El sistema calcula todas las comisiones
5. Ve a **"Liquidaciones"** y confirma
6. Paga a los barberos

### Caso 3: Un Barbero Pide Adelanto
1. Ve a dashboard, pestaña **"Adelantos"**
2. Haz click **"+ Nuevo Adelanto"**
3. Selecciona barbero y monto
4. El monto se descuenta automáticamente de su pago

### Caso 4: Necesito Ver Mis Ingresos Mensuales
1. Ve a **"Reportes"**
2. Selecciona **"Reporte Financiero"**
3. Elige el mes
4. Verás: Ingresos - Gastos = Balance Neto

### Caso 5: Desactivar un Barbero que se va
1. Ve a **"Barberos"**
2. Busca al barbero
3. Marca **"Inactivo"**
4. Haz click guardar
5. No aparecerá en nuevas transacciones pero mantiene su histórico

---

## ❓ PREGUNTAS FRECUENTES

### P: ¿Cuándo se actualizan los datos en tiempo real?
R: Los datos se actualizan instantáneamente cuando confirmas una transacción. Las liquidaciones se calculan cuando cierras la semana.

### P: ¿Puedo editar una transacción después de confirmarla?
R: Sí, en la pestaña "Transacciones" puedes editar cualquier transacción. La liquidación se recalcula automáticamente.

### P: ¿Qué pasa si anulo una transacción?
R: La transacción se marca como "Anulada" y NO se incluye en el cálculo de comisiones. El registro queda en auditoría.

### P: ¿Cómo restablezco el saldo inicial del mes?
R: Ve a dashboard, pestaña "Saldo Inicial" e ingresa el monto de caja inicial.

### P: ¿Puedo tener múltiples sucursales?
R: Sí, si tu usuario tiene acceso. En la pantalla inicial después de login, selecciona la sucursal. Puedes cambiar entre ellas desde "Volver al panel".

### P: ¿El sistema realiza backups automáticos?
R: Sí, todos los datos se respaldan automáticamente en Supabase. No necesitas hacer nada manualmente.

### P: ¿Cuáles son los horarios de soporte?
R: El soporte está disponible durante horarios comerciales (Lunes a Viernes 9am-6pm). Para emergencias, contacta al desarrollador.

### P: ¿Puedo exportar mis datos?
R: Sí, en "Reportes" puedes descargar datos en formato tabla que funciona en Excel.

---

## 🚨 SOLUCIÓN DE PROBLEMAS

### No Puedo Ingresar
- ✓ Verifica que el email sea correcto
- ✓ Revisa que la contraseña sea correcta
- ✓ Si olvidaste, usa "Recuperar contraseña"
- ✓ Si aún no funciona, contacta al administrador

### Las Transacciones no Aparecen
- ✓ Verifica que esté en la sucursal correcta
- ✓ Revisa la fecha (¿está en el rango de la semana actual?)
- ✓ Intenta refrescar la página (F5)

### El Cálculo de Comisión Parece Incorrecto
- ✓ Ve a Auditoría y revisa qué cambió
- ✓ Verifica el porcentaje de comisión del barbero en "Barberos"
- ✓ Si hay bonos, verifica en "Beneficios"

### La Página Va Lenta
- ✓ Cierra otras pestañas/aplicaciones
- ✓ Borra el caché del navegador
- ✓ Intenta con otro navegador
- ✓ Si persiste, contacta soporte

### He Cometido un Error - ¿Puedo Deshacer?
- ✓ NO hay botón "Deshacer" pero puedes:
  - Editar la transacción nuevamente
  - Marcar como "Anulada" si es necesario
  - Ve a Auditoría para ver historial completo

---

## 📞 CONTACTO Y SOPORTE

### Para Reportar Problemas
- **Email:** brunoballinari@gmail.com
- **Asunto:** [VALHALLA] Descripción del problema
- **Incluye:** Capturas de pantalla si es posible

### Información Útil para el Soporte
- Qué intentabas hacer
- Qué error viste (si hay)
- Tu navegador (Chrome, Firefox, Edge)
- La hora aproximada cuando pasó

### Horarios de Respuesta
- **Crítico** (no puedes trabajar): 2-4 horas
- **Normal**: 24-48 horas

---

## 🎉 ¡Listo!

Ya tienes todo lo que necesitas para usar VALHALLA como un pro. Si tienes dudas, revisa esta guía o contacta al soporte.

**¡Bienvenido al futuro de la gestión de tu barbería!** 💈✨

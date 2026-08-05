package ru.location.resilienttaxi.driver.core.designsystem

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

// Black-pill visual language: white ground, near-black controls, cyan accent,
// red for destructive and green for positive/online states.
private val Ink = Color(0xFF0A0A0B)
private val Paper = Color(0xFFFFFFFF)
private val Cyan = Color(0xFF12B0FF)
private val Red = Color(0xFFFF3B30)
private val InkText = Color(0xFF0B0B0C)
private val Muted = Color(0xFF6A6D75)
private val Wash = Color(0xFFF3F4F6)
private val Line = Color(0xFFE4E5EA)

private val ResilientColorScheme =
    lightColorScheme(
        primary = Ink,
        onPrimary = Paper,
        secondary = Cyan,
        onSecondary = Paper,
        tertiary = Cyan,
        onTertiary = Paper,
        background = Paper,
        onBackground = InkText,
        surface = Paper,
        onSurface = InkText,
        surfaceVariant = Wash,
        onSurfaceVariant = Muted,
        outline = Line,
        error = Red,
        onError = Paper,
    )

private val ResilientShapes =
    Shapes(
        extraSmall = RoundedCornerShape(10.dp),
        small = RoundedCornerShape(14.dp),
        medium = RoundedCornerShape(18.dp),
        large = RoundedCornerShape(22.dp),
        extraLarge = RoundedCornerShape(28.dp),
    )

@Composable
fun ResilientTaxiTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = ResilientColorScheme,
        shapes = ResilientShapes,
        content = content,
    )
}

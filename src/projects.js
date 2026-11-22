/**
 * Customize your portfolio projects here.
 *
 * Each project renders a real 3D `.stl` file on its card (`stlUrl`):
 *   - Place `.stl` files inside `./models/` (or pass any CORS-enabled URL).
 *   - Binary and ASCII `.stl` files are auto-centered and auto-scaled to fit.
 *   - Optional fields:
 *       stlRotation: [rx, ry, rz]  // e.g. [-Math.PI / 2, 0, 0] for Z-up CAD models
 *       stlScale: 1.0              // fine-tune display size multiplier
 *       stlWireframe: false        // overlay subtle wireframe edges
 */
export const PROJECTS = [
  {
    id: 'automaton-esp32-v1',
    title: 'ESP32-S3 IoT Automaton',
    tagline: '',
    category: 'Eletronics',
    year: '2026',
    accent: '#00A651',
    stlUrl: './models/PCB.stl',
    stlRotation: [0.2, 0, 0],
    stlScale: 1.0,
    stack: ['Eletronics', 'Kicad', 'IoT', 'ESP32'],
    summary:
      'An automaton board made arround a ESP32-S3 as a general purpose controler for IoT or automation.',
    highlights: [
      'Used ESP-IDF in the software running in the ESP32-S3',
      'PCB drawn using Kicad 10.0',
      'The 230VAC interface uses a solid state relay to simplify the board'
    ],
    repoUrl: 'https://github.com/Dead4ever07/ESP32-PLC'
  }
];

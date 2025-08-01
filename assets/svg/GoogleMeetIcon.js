import * as React from 'react'
import Svg, { Path } from 'react-native-svg'

function SvgComponent(props) {
    return (
        <Svg fill='none' viewBox='0 0 87.5 72' {...props} height={props.height} width={props.width}>
            <Path
                fill='#00832d'
                d='M49.5 36l8.53 9.75 11.47 7.33 2-17.02-2-16.64-11.69 6.44z'
            />
            <Path
                fill='#0066da'
                d='M0 51.5V66c0 3.315 2.685 6 6 6h14.5l3-10.96-3-9.54-9.95-3z'
            />
            <Path fill='#e94235' d='M20.5 0L0 20.5l10.55 3 9.95-3 2.95-9.41z' />
            <Path fill='#2684fc' d='M20.5 20.5H0v31h20.5z' />
            <Path
                fill='#00ac47'
                d='M82.6 8.68L69.5 19.42v33.66l13.16 10.79c1.97 1.54 4.85.135 4.85-2.37V11c0-2.535-2.945-3.925-4.91-2.32zM49.5 36v15.5h-29V72h43c3.315 0 6-2.685 6-6V53.08z'
            />
            <Path
                fill='#ffba00'
                d='M63.5 0h-43v20.5h29V36l20-16.57V6c0-3.315-2.685-6-6-6z'
            />
        </Svg>
    )
}

export default SvgComponent

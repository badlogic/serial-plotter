# Serial Plotter
VS Code extension to plot data received via a serial port, e.g. from an Arduino connected via USB. Goes well together with the VS Code PlatformIO extension.

## Data & formatting
The serial plotter displays numerical data received via the serial port. It expects the data from the device to be submitted using a line based format, where each line is terminated with `\r\n`. Each line meant to be interpreted by the serial plotter must start with a `>` and end with `\r\n`. In between those delimiters, you can have one or more `variable_name:value` pairs, separated by a coma. Variable names can be made of any sequence of UTF-8 characters, except `:`. Values should be integers or decimal numbers with a `.` as the decimal point. E.g.:

`>pin0:0.0342,brightness:234,temp:25.7\r\n`
`>pin0:2.34,brightness:200\r\n`
`>pin0:10,brightness:12\r\n`

The serial plotter will ignore all lines not starting with `>`.

When the serial plotter sees a new line starting with `>`, it will:

1. Parse out all `variable_name:value` pairs.
2. For each variable/value pair, the value is added to the list of values previously recorded for the variable.
3. For variables previously seen but not found in the new line, the serial plotter will take the last value recorded for the variable, and append it to the variables list of previously recorded values.

Step 3 ensures that the lists of values of each variable all have the same number of values in them. It's a poor man's way to ensure things are in sync without needing any timestamps.

Here's a simple sketch to illustrate the device side communication of data via the serial port:

```cpp
void setup() {
  Serial.begin(112500);
}

float angle = 0;
void loop() {
  Serial.print(">");

  Serial.print("var1:");
  Serial.print(cos(angle));
  Serial.print(",");

  Serial.print("var2:");
  Serial.print(cos(angle + PI / 2) * 0.1);
  Serial.print(",");

  Serial.print("var3:");
  Serial.print(cos(angle + PI / 4) * 1.2 + 2);
  Serial.println(); // Writes \r\n

  Serial.println("This is totally ignored");
  delay(100);

  angle += PI / 10;
}
```

The serial port is set up with a baud rate of `112500` bauds. In `loop()`, a new line for the serial plotter is emitted, with 3 variables `var1`, `var2`, and `var3`, with values generated from scaled and offset sine waves. After the line intended for the serial plotter, another line is emitted, which the plotter will ignore, as it does not start with `\r\n`.

## Opening the plotter
In VS Code, press `CTRL + SHIFT + P` (`CMD + SHIFT + P` on macOS) to bring up the command palette. Type the first few characters of `Serial Plotter: Open pane` and select the command from the palette. The Pane will open.

## Selecting port & baud rate

![docs/pane-1.png](docs/pane-1.png)

You will see the port and baud rate selector. Select the port you want to monitor from the drop down list. If you connected your device after opening the pane, click the refresh button next to the drop down. Your newly connected device should now be available in the drop down.

Select the baud rate to use. It must be the same as the baud rate you configured on your connected device.

## Monitoring
After selecting the port and baud rate, click `Start` to start monitoring. For the program above, you may see something like this.

![docs/pane-2.png](docs/pane-2.png)

Serial plotter will try to connect to the specified port and wait for lines to arrive. It will display the raw serial data in the `Raw` panel at the top. This panel is limited to the last 1000 lines received from the serial port.

The `Variables` pane shows all variables that have been encountered, including their min, max, and current value.

By default, a plot pane will also be displayed, showing all variables that have been mentioned in the first data line. You can use the checkboxes next to a variable to hide or show its data in the plot. Uncheck the `auto-scroll` checkbox, then drag the plot left or right to manually inspect the data. Use the `zoom` slider to show more or less samples in the plot (minimum 10, maximum 1000). Use the `Close` button to close the plot.

You can add additional plots by clicking the `Add plot` button.

Stop monitoring by clicking the `Stop` button at the top of the pane. You will still be able to inspect the data from the session you just stopped.

## Known issues
* A serial port can only be used by a single process. You can not monitor and e.g. upload a new program to an Arduino at the same time. If serial plotter can not connect to a serial port, make sure it's not used by another process. Conversely, if e.g. you can not upload a new program to your Arduino via PlatformIO or the Arduino IDE, make sure serial plotter is currently not monitoring the serial port of the Arduino.
* If you create multiple plots with specific variable selections, you have to recreate them if you start a new monitoring session.
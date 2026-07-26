@ECHO OFF
SET APP_HOME=%~dp0
IF DEFINED JAVA_HOME (
  "%JAVA_HOME%\bin\java.exe" -jar "%APP_HOME%gradle\wrapper\gradle-wrapper.jar" %*
) ELSE (
  java -jar "%APP_HOME%gradle\wrapper\gradle-wrapper.jar" %*
)

using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Networking;

[System.Serializable]
public class WeatherData
{
    public Main main;
}

[System.Serializable]
public class Main
{
    public float temp;
}

[System.Serializable]
public class ThingSpeakResponse
{
    public ThingSpeakFeed[] feeds;
}

[System.Serializable]
public class ThingSpeakFeed
{
    public string field1;
    public string field2;
    public string field3;
    public string field4;
    public string field5;
    public string field6;
    public string field7;
    public string field8;
}

[System.Serializable]
public class DistrictColorElements
{
    [Header("District Color Elements")]
    public List<Image> colorChangingElements = new List<Image>();
    
    [Header("Text Color Elements")]
    public List<Text> colorChangingTexts = new List<Text>();
    
    [Header("Temperature Status Images")]
    public List<Image> temperatureStatusImages = new List<Image>();
    
    [Space(5)]
    public bool showAddButton = true;
}

public class WeatherUIManager : MonoBehaviour
{
    [Header("Temperature Display UI")]
    [SerializeField] private Text khlongSanTempText;
    [SerializeField] private Text thonBuriTempText;
    [SerializeField] private Text bangRakTempText;
    [SerializeField] private Text averageTempText; // แสดงอุณหภูมิเฉลี่ยของทั้ง 3 เขต
    
    [Header("Color Changing Elements")]
    [SerializeField] private DistrictColorElements khlongSanColorElements = new DistrictColorElements();
    [SerializeField] private DistrictColorElements thonBuriColorElements = new DistrictColorElements();
    [SerializeField] private DistrictColorElements bangRakColorElements = new DistrictColorElements();
    
    [Header("Temperature Color Settings")]
    [SerializeField] private float minTemp = 20f; // อุณหภูมิต่ำสุด (สีฟ้า)
    [SerializeField] private float maxTemp = 40f; // อุณหภูมิสูงสุด (สีส้มอมแดง)
    
    [Header("Image Colors")]
    [SerializeField] private Color coldColor = new Color(0.2f, 0.6f, 1f, 1f); // สีฟ้า
    [SerializeField] private Color hotColor = new Color(1f, 0.3f, 0.1f, 1f); // สีส้มอมแดง
    
    [Header("Text Colors")]
    [SerializeField] private Color coldTextColor = new Color(0.1f, 0.4f, 0.8f, 1f); // สีฟ้าเข้มสำหรับ Text
    [SerializeField] private Color hotTextColor = new Color(0.8f, 0.2f, 0.05f, 1f); // สีแดงเข้มสำหรับ Text
    
    [Header("Temperature Status Button Colors")]
    [SerializeField] private Color coldImageColor = new Color(0f, 1f, 0.067f, 1f); // #00FF11 - เย็น (<25°C)
    [SerializeField] private Color normalImageColor = new Color(1f, 1f, 1f, 1f); // #FFFFFF - ปกติ (25-35°C)
    [SerializeField] private Color hotImageColor = new Color(1f, 0f, 0f, 1f); // #FF0000 - ร้อน (>35°C)
    
    [Header("API Settings")]
    [SerializeField] private string apiKey = "777b3dd9f7d7c557345e420d99f6c144"; // OpenWeatherMap API Key
    [SerializeField] private float updateInterval = 300f; // อัพเดททุก 5 นาที
    
    [Header("ThingSpeak Settings")]
    [SerializeField] private string thingSpeakChannelId = "3027679";
    [SerializeField] private string thingSpeakReadKey = "4M306YRQZ87072KV";
    [SerializeField] private int klongTempField = 4;  // มีข้อมูล
    [SerializeField] private int thonTempField = 0;   // ไม่มีข้อมูล
    [SerializeField] private int bangTempField = 0;   // ไม่มีข้อมูล
    
    private readonly string[] locationNames = { "Khlong San", "Thon Buri", "Bang Rak" };
    private Text[] temperatureTexts;
    private DistrictColorElements[] districtColorElements;
    private float[] currentTemperatures = new float[3] { -1f, -1f, -1f }; // เก็บอุณหภูมิปัจจุบันของแต่ละเขต (ค่าเฉลี่ย) - เริ่มต้นที่ -1 (ไม่มีข้อมูล)
    private float[] openWeatherTemps = new float[3]; // อุณหภูมิจาก OpenWeatherMap
    private float[] thingSpeakTemps = new float[3]; // อุณหภูมิจาก ThingSpeak
    private int temperatureDataCount = 0; // นับจำนวนข้อมูลที่ได้รับแล้ว
    
    void Start()
    {
        // เก็บ reference ของ Text components ไว้ใน array
        temperatureTexts = new Text[] { khlongSanTempText, thonBuriTempText, bangRakTempText };
        
        // เก็บ reference ของ color elements ไว้ใน array
        districtColorElements = new DistrictColorElements[] { khlongSanColorElements, thonBuriColorElements, bangRakColorElements };
        
        // แสดงค่าเริ่มต้นทันที
        SetInitialTemperatures();
        
        // เริ่มต้นการอัพเดทอุณหภูมิ
        StartCoroutine(UpdateTemperaturesPeriodically());
    }
    
    void OnEnable()
    {
        // เรียกดึงข้อมูลทันทีเมื่อ GameObject ถูก activate
        if (gameObject.activeInHierarchy && temperatureTexts != null)
        {
            StartCoroutine(UpdateAllTemperaturesImmediate());
        }
    }
    
    private void SetInitialTemperatures()
    {
        // ตั้งค่าเริ่มต้น - เฉพาะที่มีข้อมูล
        currentTemperatures[0] = -1f; // Khlong San - รอดึงข้อมูลจริง
        currentTemperatures[1] = -1f; // Thon Buri - ไม่มีข้อมูล
        currentTemperatures[2] = -1f; // Bang Rak - ไม่มีข้อมูล
        
        // แสดง N/A ทั้งหมดก่อนดึงข้อมูล
        for (int i = 0; i < currentTemperatures.Length; i++)
        {
            if (temperatureTexts[i] != null)
            {
                temperatureTexts[i].text = "N/A";
            }
        }
        
        // อัพเดทอุณหภูมิเฉลี่ย
        temperatureDataCount = 0;
        UpdateAverageTemperature();
    }
    
    private IEnumerator UpdateAllTemperaturesImmediate()
    {
        yield return StartCoroutine(UpdateAllTemperatures());
    }
    
    private IEnumerator UpdateTemperaturesPeriodically()
    {
        while (true)
        {
            yield return StartCoroutine(UpdateAllTemperatures());
            yield return new WaitForSeconds(updateInterval);
        }
    }
    
    private IEnumerator UpdateAllTemperatures()
    {
        // รีเซ็ตตัวนับข้อมูลอุณหภูมิ
        temperatureDataCount = 0;
        
        // เริ่มดึงข้อมูลจาก OpenWeatherMap และ ThingSpeak เฉพาะเขตที่มี field > 0
        List<Coroutine> weatherCoroutines = new List<Coroutine>();
        int[] tempFields = { klongTempField, thonTempField, bangTempField };
        
        for (int i = 0; i < locationNames.Length; i++)
        {
            // ดึงข้อมูลเฉพาะเขตที่มี ThingSpeak field
            if (tempFields[i] > 0)
            {
                weatherCoroutines.Add(StartCoroutine(GetOpenWeatherMapData(locationNames[i], i)));
                weatherCoroutines.Add(StartCoroutine(GetThingSpeakData(tempFields[i], i)));
            }
            else
            {
                // ไม่มีข้อมูล - ตั้งค่าเป็น 0
                openWeatherTemps[i] = 0f;
                thingSpeakTemps[i] = 0f;
            }
        }
        
        // รอให้ทุก coroutine เสร็จสิ้น
        foreach (Coroutine coroutine in weatherCoroutines)
        {
            yield return coroutine;
        }
        
        // คำนวณค่าเฉลี่ย (OpenWeatherMap + ThingSpeak) / 2
        CalculateAverageTemperatures();
    }
    
    private IEnumerator GetOpenWeatherMapData(string locationName, int districtIndex)
    {
        string url = $"https://api.openweathermap.org/data/2.5/weather?q={UnityWebRequest.EscapeURL(locationName)}&units=metric&appid={apiKey}";
        
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    WeatherData weatherData = JsonUtility.FromJson<WeatherData>(request.downloadHandler.text);
                    float temperature = weatherData.main.temp;
                    
                    // เก็บอุณหภูมิจาก OpenWeatherMap
                    openWeatherTemps[districtIndex] = temperature;
                    
                    Debug.Log($"OpenWeatherMap - {locationName}: {temperature:F1}°C");
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"Error parsing OpenWeatherMap data for {locationName}: {e.Message}");
                    openWeatherTemps[districtIndex] = 0f;
                }
            }
            else
            {
                Debug.LogError($"Error fetching OpenWeatherMap data for {locationName}: {request.error}");
                openWeatherTemps[districtIndex] = 0f;
            }
        }
    }
    
    private IEnumerator GetThingSpeakData(int fieldNumber, int districtIndex)
    {
        string url = $"https://api.thingspeak.com/channels/{thingSpeakChannelId}/fields/{fieldNumber}/last.txt";
        if (!string.IsNullOrEmpty(thingSpeakReadKey))
        {
            url += $"?api_key={thingSpeakReadKey}";
        }
        
        using (UnityWebRequest request = UnityWebRequest.Get(url))
        {
            yield return request.SendWebRequest();
            
            if (request.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    string responseText = request.downloadHandler.text.Trim();
                    if (float.TryParse(responseText, out float temperature))
                    {
                        // เก็บอุณหภูมิจาก ThingSpeak
                        thingSpeakTemps[districtIndex] = temperature;
                        
                        Debug.Log($"ThingSpeak Field {fieldNumber} (District {districtIndex}): {temperature:F1}°C");
                    }
                    else
                    {
                        Debug.LogWarning($"Unable to parse ThingSpeak response: {responseText}");
                        thingSpeakTemps[districtIndex] = 0f;
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"Error parsing ThingSpeak data for field {fieldNumber}: {e.Message}");
                    thingSpeakTemps[districtIndex] = 0f;
                }
            }
            else
            {
                Debug.LogError($"Error fetching ThingSpeak data for field {fieldNumber}: {request.error}");
                thingSpeakTemps[districtIndex] = 0f;
            }
        }
    }
    
    private void CalculateAverageTemperatures()
    {
        string[] districtNames = { "Khlong San", "Thon Buri", "Bang Rak" };
        int[] tempFields = { klongTempField, thonTempField, bangTempField };
        
        for (int i = 0; i < 3; i++)
        {
            float owmTemp = openWeatherTemps[i];
            float tsTemp = thingSpeakTemps[i];
            
            // ตรวจสอบว่าเขตนี้มีข้อมูลหรือไม่ (field > 0)
            if (tempFields[i] > 0)
            {
                if (owmTemp > 0 && tsTemp > 0)
                {
                    // ทั้งสองแหล่งมีข้อมูล - คำนวณค่าเฉลี่ย
                    currentTemperatures[i] = (owmTemp + tsTemp) / 2f;
                    
                    Debug.Log($"<color=green>{districtNames[i]} Average: OWM={owmTemp:F1}°C + TS={tsTemp:F1}°C = {currentTemperatures[i]:F1}°C</color>");
                }
                else if (owmTemp > 0)
                {
                    // มีเฉพาะ OpenWeatherMap
                    currentTemperatures[i] = owmTemp;
                    Debug.Log($"{districtNames[i]}: Using OpenWeatherMap only ({owmTemp:F1}°C)");
                }
                else if (tsTemp > 0)
                {
                    // มีเฉพาะ ThingSpeak
                    currentTemperatures[i] = tsTemp;
                    Debug.Log($"{districtNames[i]}: Using ThingSpeak only ({tsTemp:F1}°C)");
                }
                else
                {
                    // ไม่มีข้อมูลจากทั้งสองแหล่ง แต่ควรมี - ตั้งเป็น -1
                    currentTemperatures[i] = -1f;
                    Debug.LogWarning($"{districtNames[i]}: No data from both sources");
                }
            }
            else
            {
                // ไม่มีข้อมูลสำหรับเขตนี้ - ตั้งเป็น -1
                currentTemperatures[i] = -1f;
                Debug.Log($"{districtNames[i]}: No data configured (field = 0)");
            }
            
            // แสดงอุณหภูมิ
            if (temperatureTexts[i] != null)
            {
                if (currentTemperatures[i] >= 0)
                {
                    temperatureTexts[i].text = currentTemperatures[i].ToString("F1") + "°C";
                    // เปลี่ยนสีตามอุณหภูมิ
                    UpdateTemperatureColors(currentTemperatures[i], i);
                }
                else
                {
                    temperatureTexts[i].text = "N/A";
                    // ไม่เปลี่ยนสีสำหรับไม่มีข้อมูล
                }
            }
        }
        
        // อัพเดทอุณหภูมิเฉลี่ยของทั้ง 3 เขต
        temperatureDataCount = 3;
        UpdateAverageTemperature();
    }
    
    private void UpdateAverageTemperature()
    {
        // คำนวณอุณหภูมิเฉลี่ย
        float totalTemp = 0f;
        int validTemperatureCount = 0;
        
        for (int i = 0; i < currentTemperatures.Length; i++)
        {
            if (currentTemperatures[i] > 0) // ตรวจสอบว่ามีข้อมูลอุณหภูมิ
            {
                totalTemp += currentTemperatures[i];
                validTemperatureCount++;
            }
        }
        
        if (validTemperatureCount > 0)
        {
            float averageTemp = totalTemp / validTemperatureCount;
            
            // อัพเดท UI แสดงอุณหภูมิเฉลี่ย
            if (averageTempText != null)
            {
                averageTempText.text = averageTemp.ToString("F1") + "°C";
            }
            
            Debug.Log($"Average Temperature: {averageTemp:F1}°C (from {validTemperatureCount} districts)");
        }
        else
        {
            // ไม่มีข้อมูลอุณหภูมิที่ถูกต้อง
            if (averageTempText != null)
            {
                averageTempText.text = "N/A";
            }
        }
    }
    
    private void UpdateTemperatureColors(float temperature, int districtIndex)
    {
        if (districtIndex < 0 || districtIndex >= districtColorElements.Length)
            return;
            
        DistrictColorElements colorElements = districtColorElements[districtIndex];
        
        // คำนวณสีตามอุณหภูมิ (interpolate ระหว่างสีฟ้าและสีส้มอมแดง)
        float normalizedTemp = Mathf.Clamp01((temperature - minTemp) / (maxTemp - minTemp));
        Color temperatureColor = Color.Lerp(coldColor, hotColor, normalizedTemp);
        Color temperatureTextColor = Color.Lerp(coldTextColor, hotTextColor, normalizedTemp);
        
        // เปลี่ยนสีของ UI Image elements ทั้งหมดในเขตนี้
        foreach (Image element in colorElements.colorChangingElements)
        {
            if (element != null)
            {
                element.color = temperatureColor;
            }
        }
        
        // เปลี่ยนสีของ Text elements ทั้งหมดในเขตนี้
        foreach (Text textElement in colorElements.colorChangingTexts)
        {
            if (textElement != null)
            {
                textElement.color = temperatureTextColor;
            }
        }
        
        // เปลี่ยนสีของ Temperature Status Images ตามอุณหภูมิ
        Color imageColor = GetTemperatureStatusColor(temperature);
        foreach (Image statusImage in colorElements.temperatureStatusImages)
        {
            if (statusImage != null)
            {
                statusImage.color = imageColor;
            }
        }
    }
    
    private Color GetTemperatureStatusColor(float temperature)
    {
        if (temperature < 25f)
        {
            return coldImageColor; // #00FF11 - เย็น
        }
        else if (temperature >= 25f && temperature <= 35f)
        {
            return normalImageColor; // #FFFFFF - ปกติ
        }
        else // temperature > 35f
        {
            return hotImageColor; // #FF0000 - ร้อน
        }
    }
    
    // ปุ่มสำหรับเพิ่ม Color Elements ใน Inspector
    [ContextMenu("Add Image Element to Khlong San")]
    public void AddElementToKhlongSan()
    {
        khlongSanColorElements.colorChangingElements.Add(null);
    }
    
    [ContextMenu("Add Image Element to Thon Buri")]
    public void AddElementToThonBuri()
    {
        thonBuriColorElements.colorChangingElements.Add(null);
    }
    
    [ContextMenu("Add Image Element to Bang Rak")]
    public void AddElementToBangRak()
    {
        bangRakColorElements.colorChangingElements.Add(null);
    }
    
    // ปุ่มสำหรับเพิ่ม Text Elements
    [ContextMenu("Add Text Element to Khlong San")]
    public void AddTextElementToKhlongSan()
    {
        khlongSanColorElements.colorChangingTexts.Add(null);
    }
    
    [ContextMenu("Add Text Element to Thon Buri")]
    public void AddTextElementToThonBuri()
    {
        thonBuriColorElements.colorChangingTexts.Add(null);
    }
    
    [ContextMenu("Add Text Element to Bang Rak")]
    public void AddTextElementToBangRak()
    {
        bangRakColorElements.colorChangingTexts.Add(null);
    }
    
    // ปุ่มสำหรับเพิ่ม Temperature Status Images
    [ContextMenu("Add Status Image to Khlong San")]
    public void AddStatusImageToKhlongSan()
    {
        khlongSanColorElements.temperatureStatusImages.Add(null);
    }
    
    [ContextMenu("Add Status Image to Thon Buri")]
    public void AddStatusImageToThonBuri()
    {
        thonBuriColorElements.temperatureStatusImages.Add(null);
    }
    
    [ContextMenu("Add Status Image to Bang Rak")]
    public void AddStatusImageToBangRak()
    {
        bangRakColorElements.temperatureStatusImages.Add(null);
    }
    
    [ContextMenu("Remove Last Element from Khlong San")]
    public void RemoveLastElementFromKhlongSan()
    {
        if (khlongSanColorElements.colorChangingElements.Count > 0)
            khlongSanColorElements.colorChangingElements.RemoveAt(khlongSanColorElements.colorChangingElements.Count - 1);
    }
    
    [ContextMenu("Remove Last Element from Thon Buri")]
    public void RemoveLastElementFromThonBuri()
    {
        if (thonBuriColorElements.colorChangingElements.Count > 0)
            thonBuriColorElements.colorChangingElements.RemoveAt(thonBuriColorElements.colorChangingElements.Count - 1);
    }
    
    [ContextMenu("Remove Last Element from Bang Rak")]
    public void RemoveLastElementFromBangRak()
    {
        if (bangRakColorElements.colorChangingElements.Count > 0)
            bangRakColorElements.colorChangingElements.RemoveAt(bangRakColorElements.colorChangingElements.Count - 1);
    }
    
    // ปุ่มสำหรับลบ Text Elements
    [ContextMenu("Remove Last Text Element from Khlong San")]
    public void RemoveLastTextElementFromKhlongSan()
    {
        if (khlongSanColorElements.colorChangingTexts.Count > 0)
            khlongSanColorElements.colorChangingTexts.RemoveAt(khlongSanColorElements.colorChangingTexts.Count - 1);
    }
    
    [ContextMenu("Remove Last Text Element from Thon Buri")]
    public void RemoveLastTextElementFromThonBuri()
    {
        if (thonBuriColorElements.colorChangingTexts.Count > 0)
            thonBuriColorElements.colorChangingTexts.RemoveAt(thonBuriColorElements.colorChangingTexts.Count - 1);
    }
    
    [ContextMenu("Remove Last Text Element from Bang Rak")]
    public void RemoveLastTextElementFromBangRak()
    {
        if (bangRakColorElements.colorChangingTexts.Count > 0)
            bangRakColorElements.colorChangingTexts.RemoveAt(bangRakColorElements.colorChangingTexts.Count - 1);
    }
    
    // ปุ่มสำหรับลบ Temperature Status Images
    [ContextMenu("Remove Last Status Image from Khlong San")]
    public void RemoveLastStatusImageFromKhlongSan()
    {
        if (khlongSanColorElements.temperatureStatusImages.Count > 0)
            khlongSanColorElements.temperatureStatusImages.RemoveAt(khlongSanColorElements.temperatureStatusImages.Count - 1);
    }
    
    [ContextMenu("Remove Last Status Image from Thon Buri")]
    public void RemoveLastStatusImageFromThonBuri()
    {
        if (thonBuriColorElements.temperatureStatusImages.Count > 0)
            thonBuriColorElements.temperatureStatusImages.RemoveAt(thonBuriColorElements.temperatureStatusImages.Count - 1);
    }
    
    [ContextMenu("Remove Last Status Image from Bang Rak")]
    public void RemoveLastStatusImageFromBangRak()
    {
        if (bangRakColorElements.temperatureStatusImages.Count > 0)
            bangRakColorElements.temperatureStatusImages.RemoveAt(bangRakColorElements.temperatureStatusImages.Count - 1);
    }
    
    [ContextMenu("Test Color Changes")]
    public void TestColorChanges()
    {
        // ทดสอบสีที่อุณหภูมิต่างๆ และอุณหภูมิเฉลี่ย
        currentTemperatures[0] = 22f; // Khlong San - เย็น (<25°C) -> สีเขียว
        currentTemperatures[1] = 30f; // Thon Buri - ปกติ (25-35°C) -> สีขาว
        currentTemperatures[2] = 38f; // Bang Rak - ร้อน (>35°C) -> สีแดง
        
        UpdateTemperatureColors(22f, 0);
        UpdateTemperatureColors(30f, 1);
        UpdateTemperatureColors(38f, 2);
        
        // อัพเดทอุณหภูมิเฉลี่ย
        temperatureDataCount = 3;
        UpdateAverageTemperature();
        
        Debug.Log("Test: Khlong San 22°C (Green), Thon Buri 30°C (White), Bang Rak 38°C (Red)");
    }

    // สำหรับทดสอบการอัพเดทด้วยตนเอง
    [ContextMenu("Update Temperatures Now")]
    public void UpdateTemperaturesManually()
    {
        StartCoroutine(UpdateAllTemperatures());
    }
    
    // ฟังก์ชันสำหรับเรียกใช้จากภายนอก
    public float GetAverageTemperature()
    {
        float totalTemp = 0f;
        int validCount = 0;
        
        for (int i = 0; i < currentTemperatures.Length; i++)
        {
            if (currentTemperatures[i] > 0)
            {
                totalTemp += currentTemperatures[i];
                validCount++;
            }
        }
        
        return validCount > 0 ? totalTemp / validCount : 0f;
    }
    
    public float[] GetAllTemperatures()
    {
        return (float[])currentTemperatures.Clone();
    }
    
    public string GetTemperatureStatus(float temperature)
    {
        if (temperature < 25f)
        {
            return "Cold"; // เย็น
        }
        else if (temperature >= 25f && temperature <= 35f)
        {
            return "Normal"; // ปกติ
        }
        else // temperature > 35f
        {
            return "Hot"; // ร้อน
        }
    }
    
    public Color GetTemperatureStatusColorPublic(float temperature)
    {
        return GetTemperatureStatusColor(temperature);
    }
    
    [ContextMenu("Show Temperature Status Info")]
    public void ShowTemperatureStatusInfo()
    {
        Debug.Log("=== Temperature Status Info ===");
        string[] districtNames = { "Khlong San", "Thon Buri", "Bang Rak" };
        
        for (int i = 0; i < currentTemperatures.Length && i < districtNames.Length; i++)
        {
            float temp = currentTemperatures[i];
            string status = GetTemperatureStatus(temp);
            Color statusColor = GetTemperatureStatusColor(temp);
            
            Debug.Log($"{districtNames[i]}: {temp:F1}°C - Status: {status} - Color: #{ColorUtility.ToHtmlStringRGB(statusColor)}");
        }
        
        Debug.Log($"Average: {GetAverageTemperature():F1}°C");
        Debug.Log("Color Rules: <25°C = Green (#00FF11), 25-35°C = White (#FFFFFF), >35°C = Red (#FF0000)");
    }
}

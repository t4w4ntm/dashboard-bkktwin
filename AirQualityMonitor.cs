using System.Collections;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Networking;

// <<< แก้ไข: สร้าง Class ให้ตรงกับข้อมูลจาก ThingSpeak
[System.Serializable]
public class ThingSpeakData
{
    public string created_at;
    public int entry_id;
    public string field1; // Klong San PM2.5
    public string field2; // Thon Buri PM2.5
    public string field3; // Bang Rak PM2.5
}

// <<< เพิ่ม: Class สำหรับข้อมูล WAQI
[System.Serializable]
public class WAQIData
{
    public string status;
    public WAQIDataContent data;
}

[System.Serializable]
public class WAQIDataContent
{
    public int aqi;
    public WAQIIaqi iaqi;
}

[System.Serializable]
public class WAQIIaqi
{
    public WAQIPollutant pm25;
}

[System.Serializable]
public class WAQIPollutant
{
    public float v; // PM2.5 value
}

public class AirQualityMonitor : MonoBehaviour
{
    [Header("UI Elements")]
    [SerializeField] private Text klongSanAqiText;
    [SerializeField] private Text klongSanUgm3Text;
    [SerializeField] private Text klongSanStatusText;
    
    [SerializeField] private Text thonBuriAqiText;
    [SerializeField] private Text thonBuriUgm3Text;
    [SerializeField] private Text thonBuriStatusText;
    
    [SerializeField] private Text bangRakAqiText;
    [SerializeField] private Text bangRakUgm3Text;
    [SerializeField] private Text bangRakStatusText;
    
    [SerializeField] private Image klongSanProgressImage;
    [SerializeField] private Image thonBuriProgressImage;
    [SerializeField] private Image bangRakProgressImage;
    
    [Header("Settings")]
    // <<< แก้ไข: เปลี่ยน URL ให้ดึงทุก Field พร้อมกัน
    [SerializeField] private string thingSpeakURL = "https://api.thingspeak.com/channels/3027679/feeds/last.json?api_key=4M306YRQZ87072KV";
    [SerializeField] private string waqiToken = "75a1a645825e299fdd790d95235ca5192ef92d87";
    [SerializeField] private string waqiStation = "bangkok"; // สถานีกรุงเทพฯ
    [SerializeField] private float updateInterval = 15f; // อัพเดททุก 15 วินาที (เหมือนเว็บ)
    [SerializeField] private float animationSpeed = 0.5f;
    
    [Header("Progress Animation")]
    [SerializeField] private bool enableAnimation = true;
    
    // เก็บค่า PM2.5 และ AQI ของแต่ละเขต
    private float[] currentPM25Values = new float[3]; // [0]=Klong San, [1]=Thon Buri, [2]=Bang Rak
    private float[] currentAQIValues = new float[3];
    private float[] targetFillAmounts = new float[3];
    private float[] currentFillAmounts = new float[3];
    private float animationTime = 0f;
    private bool isAnimating = false;
    
    // Cache ข้อมูลล่าสุด - เฉพาะ Klong San มีข้อมูล
    private static float[] cachedPM25 = { 12.0f, -1f, -1f }; // -1 = ไม่มีข้อมูล
    private static float[] cachedAQI = { 0f, 0f, 0f };
    private static bool hasValidCache = false;
    
    // กำหนด field ที่มีข้อมูล (0 = ไม่มีข้อมูล)
    private int[] availableFields = { 1, 0, 0 }; // เฉพาะ Field 1 (Klong San) มีข้อมูล
    
    void Start()
    {
        // แสดงค่าเริ่มต้นทันที
        SetInitialValues();
        StartCoroutine(UpdateAirQualityDataPeriodically());
    }
    
    void OnEnable()
    {
        // เรียกดึงข้อมูลทันทีเมื่อ GameObject ถูก activate
        if (gameObject.activeInHierarchy)
        {
            StartCoroutine(FetchAirQualityDataImmediate());
        }
    }
    
    private IEnumerator FetchAirQualityDataImmediate()
    {
        yield return StartCoroutine(FetchAirQualityData());
    }
    
    private void SetInitialValues()
    {
        // ใช้ cache ถ้ามี หรือแสดงค่าเริ่มต้น
        if (hasValidCache)
        {
            for (int i = 0; i < 3; i++)
            {
                currentPM25Values[i] = cachedPM25[i];
                currentAQIValues[i] = cachedAQI[i];
            }
            UpdateAllUI();
        }
        else
        {
            // แสดงค่าเริ่มต้นก่อนดึงข้อมูลจริง - เฉพาะที่มีข้อมูล
            currentPM25Values[0] = 12.0f;  // Klong San - มีข้อมูล
            currentPM25Values[1] = -1f;    // Thon Buri - ไม่มีข้อมูล
            currentPM25Values[2] = -1f;    // Bang Rak - ไม่มีข้อมูล
            
            for (int i = 0; i < 3; i++)
            {
                if (currentPM25Values[i] >= 0)
                {
                    currentAQIValues[i] = CalculateAQI(currentPM25Values[i]);
                }
                else
                {
                    currentAQIValues[i] = -1; // ไม่มีข้อมูล
                }
            }
            
            UpdateAllUI();
        }
    }
    
    void Update()
    {
        if (enableAnimation && isAnimating)
        {
            animationTime += Time.deltaTime * animationSpeed;
            
            // อัพเดท Fill Amount สำหรับทั้ง 3 เขต
            for (int i = 0; i < 3; i++)
            {
                currentFillAmounts[i] = Mathf.Lerp(currentFillAmounts[i], targetFillAmounts[i], animationTime);
            }
            
            if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = currentFillAmounts[0];
            if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = currentFillAmounts[1];
            if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = currentFillAmounts[2];
            
            if (animationTime >= 1f)
            {
                isAnimating = false;
                // ทำให้แน่ใจว่าค่าสุดท้ายถูกต้อง
                if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = targetFillAmounts[0];
                if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = targetFillAmounts[1];
                if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = targetFillAmounts[2];
            }
        }
    }
    
    private IEnumerator UpdateAirQualityDataPeriodically()
    {
        while (true)
        {
            yield return StartCoroutine(FetchAirQualityData());
            yield return new WaitForSeconds(updateInterval);
        }
    }
    
    private IEnumerator FetchAirQualityData()
    {
        // ดึงข้อมูลจาก ThingSpeak และ WAQI พร้อมกัน
        UnityWebRequest thingSpeakRequest = UnityWebRequest.Get(thingSpeakURL);
        string waqiURL = $"https://api.waqi.info/feed/{waqiStation}/?token={waqiToken}";
        UnityWebRequest waqiRequest = UnityWebRequest.Get(waqiURL);
        
        // ส่ง request ทั้งสอง
        yield return thingSpeakRequest.SendWebRequest();
        yield return waqiRequest.SendWebRequest();
        
        float[] thingSpeakPM25 = { -1f, -1f, -1f };
        float waqiPM25 = -1f;
        
        // ดึงข้อมูลจาก ThingSpeak
        if (thingSpeakRequest.result == UnityWebRequest.Result.Success)
        {
            try
            {
                string jsonResponse = thingSpeakRequest.downloadHandler.text;
                
                if (!string.IsNullOrEmpty(jsonResponse) && jsonResponse.StartsWith("{"))
                {
                    ThingSpeakData thingSpeakData = JsonUtility.FromJson<ThingSpeakData>(jsonResponse);
                    
                    string[] fields = { thingSpeakData.field1, thingSpeakData.field2, thingSpeakData.field3 };
                    
                    for (int i = 0; i < 3; i++)
                    {
                        if (availableFields[i] > 0 && float.TryParse(fields[i], out float pm25Value))
                        {
                            thingSpeakPM25[i] = pm25Value;
                            Debug.Log($"ThingSpeak District {i}: PM2.5 = {pm25Value:F1} µg/m³");
                        }
                    }
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"Error parsing ThingSpeak data: {e.Message}");
            }
        }
        else
        {
            Debug.LogError($"Error fetching ThingSpeak data: {thingSpeakRequest.error}");
        }
        
        // ดึงข้อมูลจาก WAQI
        if (waqiRequest.result == UnityWebRequest.Result.Success)
        {
            try
            {
                string jsonResponse = waqiRequest.downloadHandler.text;
                
                if (!string.IsNullOrEmpty(jsonResponse) && jsonResponse.StartsWith("{"))
                {
                    WAQIData waqiData = JsonUtility.FromJson<WAQIData>(jsonResponse);
                    
                    if (waqiData.status == "ok" && waqiData.data != null && waqiData.data.iaqi != null && waqiData.data.iaqi.pm25 != null)
                    {
                        waqiPM25 = waqiData.data.iaqi.pm25.v;
                        Debug.Log($"WAQI: PM2.5 = {waqiPM25:F1} µg/m³");
                    }
                }
            }
            catch (System.Exception e)
            {
                Debug.LogError($"Error parsing WAQI data: {e.Message}");
            }
        }
        else
        {
            Debug.LogError($"Error fetching WAQI data: {waqiRequest.error}");
        }
        
        // คำนวณค่าเฉลี่ย: (ThingSpeak + WAQI) / 2
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        bool hasAnyValidData = false;
        
        for (int i = 0; i < 3; i++)
        {
            float tsPM = thingSpeakPM25[i];
            float finalPM25 = -1f;
            
            // เฉพาะเขตที่มีการตั้งค่า (availableFields[i] > 0)
            if (availableFields[i] > 0)
            {
                if (tsPM >= 0 && waqiPM25 >= 0)
                {
                    // มีข้อมูลทั้งสองแหล่ง - คำนวณค่าเฉลี่ย
                    finalPM25 = (tsPM + waqiPM25) / 2f;
                    Debug.Log($"{districtNames[i]}: TS={tsPM:F1}, WAQI={waqiPM25:F1}, Avg={finalPM25:F1} µg/m³");
                }
                else if (tsPM >= 0)
                {
                    // มีเฉพาะ ThingSpeak
                    finalPM25 = tsPM;
                    Debug.Log($"{districtNames[i]}: Using ThingSpeak only ({tsPM:F1} µg/m³)");
                }
                else if (waqiPM25 >= 0)
                {
                    // มีเฉพาะ WAQI
                    finalPM25 = waqiPM25;
                    Debug.Log($"{districtNames[i]}: Using WAQI only ({waqiPM25:F1} µg/m³)");
                }
                else
                {
                    // ไม่มีข้อมูลทั้งสองแหล่ง
                    Debug.Log($"{districtNames[i]}: No data available");
                }
            }
            
            // อัพเดทค่า
            if (finalPM25 >= 0)
            {
                currentPM25Values[i] = finalPM25;
                currentAQIValues[i] = CalculateAQI(finalPM25);
                
                // Cache ข้อมูลล่าสุด
                cachedPM25[i] = finalPM25;
                cachedAQI[i] = currentAQIValues[i];
                
                hasAnyValidData = true;
            }
            else
            {
                // ไม่มีข้อมูลสำหรับเขตนี้
                currentPM25Values[i] = -1f;
                currentAQIValues[i] = -1f;
                cachedPM25[i] = -1f;
                cachedAQI[i] = -1f;
            }
        }
        
        if (hasAnyValidData)
        {
            hasValidCache = true;
            UpdateAllUI();
            Debug.Log("Successfully fetched and averaged data from ThingSpeak + WAQI");
        }
        else
        {
            Debug.LogError("No valid PM2.5 data from any source");
            SetErrorState();
        }
        
        // Cleanup
        thingSpeakRequest.Dispose();
        waqiRequest.Dispose();
    }
    
    private int CalculateAQI(float pm25)
    {
        // ... (ส่วนนี้เหมือนเดิม ไม่ต้องแก้ไข)
        if (pm25 <= 12.0f) return (int)Mathf.Lerp(0, 50, pm25 / 12.0f);
        if (pm25 <= 35.4f) return (int)Mathf.Lerp(51, 100, (pm25 - 12.1f) / (35.4f - 12.1f));
        if (pm25 <= 55.4f) return (int)Mathf.Lerp(101, 150, (pm25 - 35.5f) / (55.4f - 35.5f));
        if (pm25 <= 150.4f) return (int)Mathf.Lerp(151, 200, (pm25 - 55.5f) / (150.4f - 55.5f));
        if (pm25 <= 250.4f) return (int)Mathf.Lerp(201, 300, (pm25 - 150.5f) / (250.4f - 150.5f));
        if (pm25 <= 350.4f) return (int)Mathf.Lerp(301, 400, (pm25 - 250.5f) / (350.4f - 250.5f));
        if (pm25 <= 500.4f) return (int)Mathf.Lerp(401, 500, (pm25 - 350.5f) / (500.4f - 350.5f));
        return 500;
    }

    private string GetQualityStatus(float pm25)
    {
        // ... (ส่วนนี้เหมือนเดิม ไม่ต้องแก้ไข)
        if (pm25 <= 12.0f) return "Good";
        if (pm25 <= 35.4f) return "Moderate";
        if (pm25 <= 55.4f) return "Unhealthy for Sensitive Groups";
        if (pm25 <= 150.4f) return "Unhealthy";
        if (pm25 <= 250.4f) return "Very Unhealthy";
        return "Hazardous";
    }
    
    private void UpdateAllUI()
    {
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        Text[] aqiTexts = { klongSanAqiText, thonBuriAqiText, bangRakAqiText };
        Text[] ugm3Texts = { klongSanUgm3Text, thonBuriUgm3Text, bangRakUgm3Text };
        Text[] statusTexts = { klongSanStatusText, thonBuriStatusText, bangRakStatusText };
        
        for (int i = 0; i < 3; i++)
        {
            // ตรวจสอบว่ามีข้อมูลหรือไม่
            if (currentPM25Values[i] >= 0 && currentAQIValues[i] >= 0)
            {
                // มีข้อมูล - แสดงค่าปกติ
                if (aqiTexts[i] != null)
                    aqiTexts[i].text = currentAQIValues[i].ToString("F0");
                
                if (ugm3Texts[i] != null)
                    ugm3Texts[i].text = currentPM25Values[i].ToString("F1");
                
                if (statusTexts[i] != null)
                    statusTexts[i].text = GetQualityStatus(currentPM25Values[i]);
                
                targetFillAmounts[i] = Mathf.Clamp01(currentAQIValues[i] / 500f);
            }
            else
            {
                // ไม่มีข้อมูล - แสดง N/A
                if (aqiTexts[i] != null)
                    aqiTexts[i].text = "---";
                
                if (ugm3Texts[i] != null)
                    ugm3Texts[i].text = "N/A";
                
                if (statusTexts[i] != null)
                    statusTexts[i].text = "No Data";
                
                targetFillAmounts[i] = 0f;
            }
        }
        
        if (enableAnimation)
        {
            isAnimating = true;
            animationTime = 0f;
        }
        else
        {
            // อัพเดทโดยไม่มี Animation
            if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = targetFillAmounts[0];
            if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = targetFillAmounts[1];
            if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = targetFillAmounts[2];
        }
    }
    
    private void SetErrorState()
    {
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        Text[] aqiTexts = { klongSanAqiText, thonBuriAqiText, bangRakAqiText };
        Text[] ugm3Texts = { klongSanUgm3Text, thonBuriUgm3Text, bangRakUgm3Text };
        Text[] statusTexts = { klongSanStatusText, thonBuriStatusText, bangRakStatusText };
        
        for (int i = 0; i < 3; i++)
        {
            if (aqiTexts[i] != null) aqiTexts[i].text = "Error";
            if (ugm3Texts[i] != null) ugm3Texts[i].text = "--";
            if (statusTexts[i] != null) statusTexts[i].text = "Connection Error";
        }
    }
}